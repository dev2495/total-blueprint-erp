package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	appVersion           = "3.0.1"
	configVersion        = 3
	maxJobBytes          = 2 * 1024 * 1024
	expectedHeader       = "TPPPRINT/1\nprinter=EPSON-FX-2175II\npaper=15x5.5\nlanguage=ESC/P"
	officialDriverName   = "FX2175II_1000_WW_1152921504627097281.zip"
	officialDriverBytes  = int64(8847392)
	officialDriverURL    = "https://download-center.epson.com/f/module/f42d39dd-4407-4232-b6bc-09966d2420ce/FX2175II_1000_WW_1152921504627097281.zip"
	officialSupportURL   = "https://www.epson.co.in/Support/Printers/Dot-Matrix-Printers/FX-Series/Epson-FX-2175II/s/SPRT_C11CF38509"
	officialLicenseURL   = "https://www.epson.co.in/SoftwareLicenseAgreement"
	heartbeatFreshWindow = 20 * time.Second
	jobStabilityWindow   = 600 * time.Millisecond
	jobPollInterval      = 300 * time.Millisecond
)

var (
	requiredPrefix = []byte{27, 64, 18, 27, 80, 27, 50, 27, 67, 33, 27, 79, 27, 69, 27, 71, 27, 120, 1, 27, 107, 0, 27, 85, 1, 27, 70, 27, 72}
	epsonPattern   = regexp.MustCompile(`(?i)^EPSON.*FX[- ]?2175(?:II)?(?:\s|$|\()`)
	exactIIPattern = regexp.MustCompile(`(?i)FX[- ]?2175II(?:\s|$|\()`)
)

type config struct {
	Version      int       `json:"version"`
	Helper       string    `json:"helper_version"`
	PrinterName  string    `json:"printer_name"`
	InstalledAt  time.Time `json:"installed_at"`
	DriverSource string    `json:"driver_source"`
}

type status struct {
	Version      string    `json:"version"`
	PID          int       `json:"pid"`
	PrinterName  string    `json:"printer_name"`
	DownloadsDir string    `json:"downloads_dir"`
	StartedAt    time.Time `json:"started_at"`
	HeartbeatAt  time.Time `json:"heartbeat_at"`
	LastJob      string    `json:"last_job,omitempty"`
	LastError    string    `json:"last_error,omitempty"`
}

type appPaths struct {
	Base       string
	Config     string
	Status     string
	PID        string
	Stop       string
	Processing string
	Printed    string
	Failed     string
	Logs       string
	Log        string
}

type logger struct {
	path string
	mu   sync.Mutex
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		if !isAgentArgs(os.Args[1:]) {
			prepareConsole()
			fmt.Fprintf(os.Stderr, "\nSETUP DID NOT FINISH\n%s\n", err)
			fmt.Fprintln(os.Stderr, "\nPress Enter to close.")
			_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		}
		os.Exit(1)
	}
}

func run(args []string) error {
	switch {
	case len(args) == 0 || args[0] == "--install":
		prepareConsole()
		return install()
	case args[0] == "--agent":
		return runAgent()
	case args[0] == "--print-file" && len(args) == 2:
		return printOneFile(args[1])
	case args[0] == "--status":
		prepareConsole()
		return printStatus()
	case args[0] == "--diagnose":
		prepareConsole()
		return diagnose()
	case args[0] == "--machine-setup":
		return ensurePaperForm()
	case args[0] == "--self-test":
		prepareConsole()
		return selfTest()
	case args[0] == "--uninstall":
		prepareConsole()
		return uninstall()
	default:
		return fmt.Errorf("unknown command")
	}
}

func isAgentArgs(args []string) bool {
	return len(args) > 0 && (args[0] == "--agent" || args[0] == "--print-file" || args[0] == "--machine-setup")
}

func paths() (appPaths, error) {
	base, err := platformDataDir()
	if err != nil {
		return appPaths{}, err
	}
	p := appPaths{Base: base}
	p.Config = filepath.Join(base, "config.json")
	p.Status = filepath.Join(base, "agent-status.json")
	p.PID = filepath.Join(base, "agent.pid")
	p.Stop = filepath.Join(base, "agent.stop")
	p.Processing = filepath.Join(base, "Processing")
	p.Printed = filepath.Join(base, "Printed")
	p.Failed = filepath.Join(base, "Failed")
	p.Logs = filepath.Join(base, "Logs")
	p.Log = filepath.Join(p.Logs, "helper.log")
	return p, nil
}

func (p appPaths) ensure() error {
	for _, dir := range []string{p.Base, p.Processing, p.Printed, p.Failed, p.Logs} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return nil
}

func (l *logger) write(level, message string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if info, err := os.Stat(l.path); err == nil && info.Size() > 2*1024*1024 {
		_ = os.Rename(l.path, l.path+".1")
	}
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = fmt.Fprintf(f, "%s [%s] %s\n", time.Now().Format("2006-01-02 15:04:05"), level, message)
}

func install() error {
	if runtime.GOOS != "windows" {
		return errors.New("this setup must be run on Windows 10 or Windows 11")
	}
	fmt.Println("TOTAL POLY PRINT - EPSON FX-2175II ONE-CLICK SETUP")
	fmt.Printf("Native helper version %s - no PowerShell watcher is used.\n\n", appVersion)

	p, err := paths()
	if err != nil {
		return err
	}
	if err := p.ensure(); err != nil {
		return fmt.Errorf("create helper folders: %w", err)
	}

	fmt.Println("[1/8] Removing the blocked legacy PowerShell startup...")
	_ = stopLegacyHelper(p)
	if err := unregisterLegacyStartup(); err != nil {
		return fmt.Errorf("remove legacy startup entry: %w", err)
	}

	fmt.Println("[2/8] Checking Windows print spooler...")
	printers, err := listPrinters()
	if err != nil {
		return fmt.Errorf("Windows print spooler is unavailable: %w", err)
	}
	selected := chooseEpsonPrinter(printers)
	driverSource := "existing Epson Windows queue"
	if selected == "" {
		fmt.Println("      EPSON FX-2175II is not installed.")
		if err := installOfficialDriver(); err != nil {
			return err
		}
		driverSource = "Epson official download v1.0.0.0"
		printers, err = listPrinters()
		if err != nil {
			return err
		}
		selected = chooseEpsonPrinter(printers)
		if selected == "" {
			return errors.New("the official driver completed but no EPSON FX-2175II queue exists; connect the printer by USB and run this setup once more")
		}
	}
	fmt.Printf("      Using: %s\n", selected)
	if err := probePrinter(selected); err != nil {
		return fmt.Errorf("the selected Epson queue cannot be opened: %w", err)
	}

	fmt.Println("[3/8] Installing the native helper...")
	installedExe, err := installCurrentExecutable(p)
	if err != nil {
		return err
	}

	cfg := config{Version: configVersion, Helper: appVersion, PrinterName: selected, InstalledAt: time.Now(), DriverSource: driverSource}
	if err := writeJSONAtomic(p.Config, cfg); err != nil {
		return fmt.Errorf("save printer configuration: %w", err)
	}
	quarantined, retained := 0, 0
	if downloads, downloadsErr := downloadsDir(); downloadsErr == nil {
		quarantined, retained = quarantinePreexistingJobs(downloads, cfg, p)
	}
	if quarantined > 0 {
		fmt.Printf("      Moved %d old unprinted job(s) to Failed for duplicate-print review.\n", quarantined)
	}
	if retained > 0 {
		fmt.Printf("      Ignoring %d old job(s) that could not be moved; download a fresh job when ready.\n", retained)
	}

	fmt.Println("[4/8] Registering automatic start and .tppprint ownership...")
	if err := registerAutostart(installedExe); err != nil {
		return err
	}
	if err := registerFileAssociation(installedExe); err != nil {
		return err
	}
	notifyAssociationChanged()

	fmt.Println("[5/8] Creating the TPP 15x5.5 continuous-paper form...")
	paperFormStatus := "Windows form registered"
	if err := ensurePaperForm(); err != nil {
		fmt.Println("      Administrator permission is required once for the paper form.")
		if err := runElevatedAndWait(installedExe, "--machine-setup"); err != nil {
			paperFormStatus = "RAW ESC/P form length active; optional Windows form unavailable"
			fmt.Printf("      WARNING: Windows could not register the optional paper form (%s).\n", err)
			fmt.Println("      Continuing safely: every ERP Epson job carries its own 5.5-inch ESC/P form length.")
		}
	}

	fmt.Println("[6/8] Starting the native background helper...")
	_ = os.Remove(p.Stop)
	if err := startAgent(installedExe); err != nil {
		return fmt.Errorf("start native helper: %w", err)
	}

	fmt.Println("[7/8] Waiting for verified helper heartbeat...")
	if err := waitForHealthyAgent(p, selected, 15*time.Second); err != nil {
		return err
	}

	fmt.Println("[8/8] Running safe protocol and spooler self-test...")
	if _, err := validateJob(testJob()); err != nil {
		return fmt.Errorf("internal print-contract self-test failed: %w", err)
	}
	if err := probePrinter(selected); err != nil {
		return fmt.Errorf("final printer probe failed: %w", err)
	}

	fmt.Println("\nSETUP COMPLETE")
	fmt.Printf("Printer: %s\n", selected)
	fmt.Println("Paper: 15 x 5.5 inch continuous tractor form")
	fmt.Printf("Paper setup: %s\n", paperFormStatus)
	fmt.Println("File handling: .tppprint is owned by Total Poly Print, not Word")
	fmt.Println("You may now return to ERP and click Epson tractor print.")
	fmt.Println("No test slip was printed during setup.")
	fmt.Println("\nPress Enter to close.")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	return nil
}

func chooseEpsonPrinter(printers []string) string {
	var exactII, compatible []string
	for _, name := range printers {
		if !epsonPattern.MatchString(strings.TrimSpace(name)) {
			continue
		}
		if exactIIPattern.MatchString(name) {
			exactII = append(exactII, name)
		} else {
			compatible = append(compatible, name)
		}
	}
	sort.Strings(exactII)
	sort.Strings(compatible)
	if len(exactII) > 0 {
		for _, name := range exactII {
			if strings.EqualFold(strings.TrimSpace(name), "EPSON FX-2175II") {
				return name
			}
		}
		return exactII[0]
	}
	if len(compatible) > 0 {
		return compatible[0]
	}
	return ""
}

func installCurrentExecutable(p appPaths) (string, error) {
	source, err := os.Executable()
	if err != nil {
		return "", err
	}
	destination := filepath.Join(p.Base, "TppEpsonPrint-"+appVersion+".exe")
	if same, _ := filesEqual(source, destination); !same {
		if err := copyFileAtomic(source, destination); err != nil {
			return "", fmt.Errorf("copy native helper: %w", err)
		}
	}
	return destination, nil
}

func filesEqual(a, b string) (bool, error) {
	left, err := fileSHA256(a)
	if err != nil {
		return false, err
	}
	right, err := fileSHA256(b)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return left == right, nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func copyFileAtomic(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	temporary := destination + ".new"
	out, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	return replaceFileAtomic(temporary, destination)
}

func writeJSONAtomic(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	temporary := path + ".new"
	if err := os.WriteFile(temporary, payload, 0o600); err != nil {
		return err
	}
	return replaceFileAtomic(temporary, path)
}

func readConfig(p appPaths) (config, error) {
	payload, err := os.ReadFile(p.Config)
	if err != nil {
		return config{}, err
	}
	var cfg config
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return config{}, err
	}
	if cfg.Version != configVersion || cfg.PrinterName == "" {
		return config{}, errors.New("configuration is invalid; run setup again")
	}
	return cfg, nil
}

func waitForHealthyAgent(p appPaths, printer string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var last string
	for time.Now().Before(deadline) {
		payload, err := os.ReadFile(p.Status)
		if err == nil {
			var state status
			if json.Unmarshal(payload, &state) == nil {
				last = state.LastError
				if state.Version == appVersion && state.PrinterName == printer && time.Since(state.HeartbeatAt) <= heartbeatFreshWindow {
					return nil
				}
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	if last != "" {
		return fmt.Errorf("native helper did not become healthy: %s", last)
	}
	return fmt.Errorf("native helper did not publish a heartbeat within %s; see %s", timeout, p.Log)
}

func runAgent() error {
	p, err := paths()
	if err != nil {
		return err
	}
	if err := p.ensure(); err != nil {
		return err
	}
	release, acquired, err := acquireSingleAgent()
	if err != nil {
		return err
	}
	if !acquired {
		return nil
	}
	defer release()
	log := &logger{path: p.Log}
	cfg, err := readConfig(p)
	if err != nil {
		log.write("ERROR", err.Error())
		return err
	}
	if err := probePrinter(cfg.PrinterName); err != nil {
		log.write("ERROR", "Printer probe failed: "+err.Error())
		return err
	}
	downloads, err := downloadsDir()
	if err != nil {
		log.write("ERROR", err.Error())
		return err
	}
	if err := os.MkdirAll(downloads, 0o755); err != nil {
		return err
	}
	started := time.Now()
	state := status{Version: appVersion, PID: os.Getpid(), PrinterName: cfg.PrinterName, DownloadsDir: downloads, StartedAt: started, HeartbeatAt: started}
	_ = os.WriteFile(p.PID, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o600)
	if err := writeJSONAtomic(p.Status, state); err != nil {
		return fmt.Errorf("publish initial helper heartbeat: %w", err)
	}
	defer os.Remove(p.PID)
	defer os.Remove(p.Status)
	log.write("INFO", fmt.Sprintf("Native helper %s started. Watching '%s' for '%s'.", appVersion, downloads, cfg.PrinterName))

	quarantineInterrupted(p, log)
	cleanupArchive(p.Printed, 30*24*time.Hour)
	heartbeat := time.NewTicker(5 * time.Second)
	poll := time.NewTicker(jobPollInterval)
	defer heartbeat.Stop()
	defer poll.Stop()
	for {
		select {
		case <-heartbeat.C:
			state.HeartbeatAt = time.Now()
			_ = writeJSONAtomic(p.Status, state)
		case <-poll.C:
			if _, err := os.Stat(p.Stop); err == nil {
				_ = os.Remove(p.Stop)
				log.write("INFO", "Stop requested by setup/uninstall.")
				return nil
			}
			jobs, _ := filepath.Glob(filepath.Join(downloads, "*.tppprint"))
			sort.Strings(jobs)
			for _, job := range jobs {
				info, err := os.Stat(job)
				if err != nil || info.ModTime().Before(cfg.InstalledAt) || time.Since(info.ModTime()) < jobStabilityWindow {
					continue
				}
				state.LastJob = filepath.Base(job)
				state.LastError = ""
				if err := processJobFile(job, cfg.PrinterName, p, log); err != nil {
					state.LastError = err.Error()
				}
				state.HeartbeatAt = time.Now()
				_ = writeJSONAtomic(p.Status, state)
			}
		}
	}
}

func printOneFile(path string) error {
	p, err := paths()
	if err != nil {
		return err
	}
	if err := p.ensure(); err != nil {
		return err
	}
	cfg, err := readConfig(p)
	if err != nil {
		return err
	}
	downloads, err := downloadsDir()
	if err != nil {
		return err
	}
	if !pathWithin(path, downloads) {
		return errors.New("only .tppprint jobs from this Windows user's Downloads folder are accepted")
	}
	log := &logger{path: p.Log}
	if info, err := os.Stat(path); err != nil {
		return err
	} else if info.ModTime().Before(cfg.InstalledAt) {
		message := "ignored an old .tppprint job that predates this setup; download a fresh dispatch job to prevent a duplicate print"
		log.write("WARN", message+": "+filepath.Base(path))
		return errors.New(message)
	}
	return processJobFile(path, cfg.PrinterName, p, log)
}

func pathWithin(path, root string) bool {
	abs, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	base, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(base, abs)
	if err != nil {
		return false
	}
	return rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) && strings.EqualFold(filepath.Ext(abs), ".tppprint")
}

func processJobFile(source, printer string, p appPaths, log *logger) error {
	claimed := filepath.Join(p.Processing, fmt.Sprintf("%s-%s-%s", time.Now().Format("20060102-150405.000"), randomSuffix(), filepath.Base(source)))
	if err := os.Rename(source, claimed); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("claim print job: %w", err)
	}
	printed := false
	defer func() {
		if printed {
			return
		}
		if _, err := os.Stat(claimed); err == nil {
			_ = os.Rename(claimed, filepath.Join(p.Failed, "failed-"+filepath.Base(claimed)))
		}
	}()
	payload, err := os.ReadFile(claimed)
	if err != nil {
		return err
	}
	raw, err := validateJob(payload)
	if err != nil {
		log.write("ERROR", fmt.Sprintf("Rejected '%s': %s", filepath.Base(source), err))
		return err
	}
	if err := sendRaw(printer, raw, strings.TrimSuffix(filepath.Base(source), filepath.Ext(source))); err != nil {
		log.write("ERROR", fmt.Sprintf("Spooler rejected '%s': %s", filepath.Base(source), err))
		return err
	}
	destination := filepath.Join(p.Printed, filepath.Base(claimed))
	if err := os.Rename(claimed, destination); err != nil {
		return fmt.Errorf("archive accepted print job: %w", err)
	}
	printed = true
	log.write("INFO", fmt.Sprintf("Printed '%s' on '%s' using RAW 10-CPI Roman NLQ unidirectional mode.", filepath.Base(source), printer))
	return nil
}

func validateJob(job []byte) ([]byte, error) {
	if len(job) < 64 || len(job) > maxJobBytes {
		return nil, errors.New("print job size is invalid")
	}
	separator := bytes.Index(job, []byte("\n\n"))
	if separator < 0 {
		return nil, errors.New("print job header is missing")
	}
	if string(job[:separator]) != expectedHeader {
		return nil, errors.New("print job header is not approved for EPSON FX-2175II")
	}
	payload := job[separator+2:]
	if len(payload) <= len(requiredPrefix) {
		return nil, errors.New("print payload is empty")
	}
	if !bytes.HasPrefix(payload, requiredPrefix) {
		return nil, errors.New("print controls do not match the approved 15 x 5.5 inch layout")
	}
	if !bytes.Contains(payload, []byte{12}) {
		return nil, errors.New("print payload has no form-feed command")
	}
	return append([]byte(nil), payload...), nil
}

func testJob() []byte {
	job := append([]byte(expectedHeader+"\n\n"), requiredPrefix...)
	job = append(job, []byte("TOTAL POLY PRINT SETUP SELF-TEST - NOT SENT TO PRINTER\r\n")...)
	return append(job, 12)
}

func selfTest() error {
	raw, err := validateJob(testJob())
	if err != nil {
		return fmt.Errorf("print-contract validation: %w", err)
	}
	if !bytes.HasPrefix(raw, requiredPrefix) || raw[len(raw)-1] != 12 {
		return errors.New("print-contract payload was altered")
	}
	fmt.Printf("Total Poly Print Epson Helper %s self-test: OK\n", appVersion)
	return nil
}

func randomSuffix() string {
	now := time.Now().UnixNano()
	hash := sha256.Sum256([]byte(fmt.Sprintf("%d-%d", now, os.Getpid())))
	return hex.EncodeToString(hash[:4])
}

func quarantinePreexistingJobs(downloads string, cfg config, p appPaths) (quarantined, retained int) {
	jobs, _ := filepath.Glob(filepath.Join(downloads, "*.tppprint"))
	for _, job := range jobs {
		info, err := os.Stat(job)
		if err != nil || !info.ModTime().Before(cfg.InstalledAt) {
			continue
		}
		destination := filepath.Join(p.Failed, fmt.Sprintf("preinstall-review-%s-%s-%s", time.Now().Format("20060102-150405.000"), randomSuffix(), filepath.Base(job)))
		if os.Rename(job, destination) == nil {
			quarantined++
		} else {
			retained++
		}
	}
	return quarantined, retained
}

func quarantineInterrupted(p appPaths, log *logger) {
	jobs, _ := filepath.Glob(filepath.Join(p.Processing, "*.tppprint"))
	for _, job := range jobs {
		destination := filepath.Join(p.Failed, "restart-review-"+filepath.Base(job))
		if os.Rename(job, destination) == nil {
			log.write("WARN", "Moved interrupted job to Failed for manual review: "+filepath.Base(job))
		}
	}
}

func cleanupArchive(directory string, age time.Duration) {
	entries, _ := os.ReadDir(directory)
	cutoff := time.Now().Add(-age)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(directory, entry.Name()))
		}
	}
}

func printStatus() error {
	p, err := paths()
	if err != nil {
		return err
	}
	payload, err := os.ReadFile(p.Status)
	if err != nil {
		return fmt.Errorf("helper is not running; run setup again (%s)", p.Log)
	}
	var state status
	if err := json.Unmarshal(payload, &state); err != nil {
		return err
	}
	statePayload, _ := json.MarshalIndent(state, "", "  ")
	fmt.Println(string(statePayload))
	if time.Since(state.HeartbeatAt) > heartbeatFreshWindow {
		return errors.New("helper heartbeat is stale")
	}
	return nil
}

func diagnose() error {
	p, err := paths()
	if err != nil {
		return err
	}
	fmt.Printf("Total Poly Print Epson Helper %s\n", appVersion)
	fmt.Printf("State directory: %s\n", p.Base)
	printers, printerErr := listPrinters()
	if printerErr != nil {
		fmt.Printf("Spooler: ERROR - %s\n", printerErr)
	} else {
		fmt.Printf("Spooler: OK - %d queue(s)\n", len(printers))
		for _, printer := range printers {
			if epsonPattern.MatchString(printer) {
				fmt.Printf("  Epson candidate: %s\n", printer)
			}
		}
	}
	if cfg, cfgErr := readConfig(p); cfgErr != nil {
		fmt.Printf("Configuration: ERROR - %s\n", cfgErr)
	} else {
		fmt.Printf("Configured printer: %s\n", cfg.PrinterName)
		if err := probePrinter(cfg.PrinterName); err != nil {
			fmt.Printf("Printer probe: ERROR - %s\n", err)
		} else {
			fmt.Println("Printer probe: OK")
		}
	}
	if err := printStatus(); err != nil {
		fmt.Printf("Agent: ERROR - %s\n", err)
	} else {
		fmt.Println("Agent: OK")
	}
	return nil
}

func stopLegacyHelper(p appPaths) error {
	_ = os.WriteFile(p.Stop, []byte(time.Now().Format(time.RFC3339Nano)), 0o600)
	time.Sleep(1500 * time.Millisecond)
	pidBytes, err := os.ReadFile(p.PID)
	if err != nil {
		return nil
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(pidBytes)))
	if err != nil || pid <= 0 || pid == os.Getpid() {
		return nil
	}
	if running, name := processIdentity(pid); running && (strings.EqualFold(name, "powershell.exe") || strings.HasPrefix(strings.ToLower(name), "tpp-epson")) {
		_ = terminateProcess(pid)
		time.Sleep(750 * time.Millisecond)
	}
	return nil
}

func uninstall() error {
	p, err := paths()
	if err != nil {
		return err
	}
	fmt.Println("Removing Total Poly Print Epson helper...")
	_ = os.WriteFile(p.Stop, []byte(time.Now().Format(time.RFC3339Nano)), 0o600)
	time.Sleep(2 * time.Second)
	if err := unregisterAutostartAndAssociation(); err != nil {
		return err
	}
	_ = unregisterLegacyStartup()
	fmt.Printf("Helper stopped and Windows registrations removed. Logs and print history remain in %s.\n", p.Base)
	fmt.Println("The Epson driver and printer queue were not removed.")
	return nil
}

func installOfficialDriver() error {
	fmt.Println("\nThe printer driver is Epson software and is not republished inside this setup.")
	fmt.Println("Official package: FX-2175II Printer Driver 1.0.0.0 for Windows 10/11 x64")
	fmt.Printf("License: %s\n", officialLicenseURL)
	fmt.Print("Type I AGREE to accept Epson's license and download/install it from Epson: ")
	answer, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	if strings.TrimSpace(answer) != "I AGREE" {
		_ = openURL(officialSupportURL)
		return errors.New("Epson driver installation was not accepted; the official support page has been opened")
	}
	temporary, err := os.MkdirTemp("", "tpp-epson-driver-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	archive := filepath.Join(temporary, officialDriverName)
	fmt.Println("Downloading the official Epson package...")
	if err := downloadOfficialDriver(archive); err != nil {
		_ = openURL(officialSupportURL)
		return fmt.Errorf("automatic official download failed (%v); Epson's download page has been opened", err)
	}
	extracted := filepath.Join(temporary, "driver")
	if err := extractZipSafely(archive, extracted); err != nil {
		return err
	}
	if err := installDriverINFs(extracted); err != nil {
		return err
	}
	return nil
}

func downloadOfficialDriver(destination string) error {
	client := &http.Client{Timeout: 3 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" || !strings.EqualFold(req.URL.Hostname(), "download-center.epson.com") {
			return errors.New("Epson download redirected outside download-center.epson.com")
		}
		return nil
	}}
	req, err := http.NewRequest(http.MethodGet, officialDriverURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TotalPolyPrintEpsonSetup/"+appVersion)
	req.Header.Set("Referer", "https://download-center.epson.com/")
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("Epson returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > 0 && response.ContentLength != officialDriverBytes {
		return fmt.Errorf("unexpected Epson package size %d", response.ContentLength)
	}
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	written, copyErr := io.Copy(out, io.LimitReader(response.Body, officialDriverBytes+1))
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written != officialDriverBytes {
		return fmt.Errorf("official package size was %d, expected %d", written, officialDriverBytes)
	}
	archiveFile, err := os.Open(destination)
	if err != nil {
		return err
	}
	defer archiveFile.Close()
	prefix := make([]byte, 4)
	if _, err := io.ReadFull(archiveFile, prefix); err != nil {
		return err
	}
	if !bytes.Equal(prefix, []byte{'P', 'K', 3, 4}) {
		return errors.New("official package is not a ZIP archive")
	}
	return nil
}

func extractZipSafely(archive, destination string) error {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer reader.Close()
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}
	for _, file := range reader.File {
		clean := filepath.Clean(file.Name)
		if clean == "." || filepath.IsAbs(clean) || filepath.VolumeName(clean) != "" || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) || clean == ".." {
			return errors.New("Epson archive contains an unsafe path")
		}
		target := filepath.Join(destination, clean)
		if !pathWithinRoot(target, destination) {
			return errors.New("Epson archive contains a path outside the extraction folder")
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if file.UncompressedSize64 > 100*1024*1024 {
			return errors.New("Epson archive contains an unexpectedly large file")
		}
		source, err := file.Open()
		if err != nil {
			return err
		}
		dest, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			source.Close()
			return err
		}
		written, copyErr := io.Copy(dest, io.LimitReader(source, 100*1024*1024+1))
		closeDestErr := dest.Close()
		closeSourceErr := source.Close()
		if copyErr != nil {
			return copyErr
		}
		if written > 100*1024*1024 {
			return errors.New("Epson archive expansion limit was exceeded")
		}
		if closeDestErr != nil {
			return closeDestErr
		}
		if closeSourceErr != nil {
			return closeSourceErr
		}
	}
	return nil
}

func pathWithinRoot(path, root string) bool {
	abs, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	base, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(base, abs)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func installDriverINFs(directory string) error {
	var infs []string
	err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(entry.Name()), ".inf") {
			infs = append(infs, path)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if len(infs) == 0 {
		return errors.New("official Epson archive contains no INF driver package")
	}
	return installSignedDriversElevated(directory)
}
