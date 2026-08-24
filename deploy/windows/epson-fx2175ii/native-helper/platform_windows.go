//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const (
	printerEnumLocal        = 0x00000002
	printerEnumConnections  = 0x00000004
	processQueryLimited     = 0x1000
	processTerminate        = 0x0001
	createNoWindow          = 0x08000000
	detachedProcess         = 0x00000008
	seeMaskNoCloseProcess   = 0x00000040
	swShowNormal            = 1
	moveFileReplaceExisting = 0x00000001
	moveFileWriteThrough    = 0x00000008
	shcneAssocChanged       = 0x08000000
	shcnfIDList             = 0x0000
	printerAccessAdminister = 0x00000004
	errorFileExists         = syscall.Errno(80)
	errorAlreadyExists      = syscall.Errno(183)
)

var (
	kernel32               = syscall.NewLazyDLL("kernel32.dll")
	winspool               = syscall.NewLazyDLL("winspool.drv")
	shell32                = syscall.NewLazyDLL("shell32.dll")
	ole32                  = syscall.NewLazyDLL("ole32.dll")
	procAllocConsole       = kernel32.NewProc("AllocConsole")
	procGetConsoleWindow   = kernel32.NewProc("GetConsoleWindow")
	procCreateMutex        = kernel32.NewProc("CreateMutexW")
	procReleaseMutex       = kernel32.NewProc("ReleaseMutex")
	procCloseHandle        = kernel32.NewProc("CloseHandle")
	procOpenProcess        = kernel32.NewProc("OpenProcess")
	procTerminateProcess   = kernel32.NewProc("TerminateProcess")
	procQueryProcessName   = kernel32.NewProc("QueryFullProcessImageNameW")
	procWaitForSingle      = kernel32.NewProc("WaitForSingleObject")
	procGetExitCodeProcess = kernel32.NewProc("GetExitCodeProcess")
	procMoveFileEx         = kernel32.NewProc("MoveFileExW")
	procEnumPrinters       = winspool.NewProc("EnumPrintersW")
	procOpenPrinter        = winspool.NewProc("OpenPrinterW")
	procClosePrinter       = winspool.NewProc("ClosePrinter")
	procStartDocPrinter    = winspool.NewProc("StartDocPrinterW")
	procEndDocPrinter      = winspool.NewProc("EndDocPrinter")
	procStartPagePrinter   = winspool.NewProc("StartPagePrinter")
	procEndPagePrinter     = winspool.NewProc("EndPagePrinter")
	procWritePrinter       = winspool.NewProc("WritePrinter")
	procAddForm            = winspool.NewProc("AddFormW")
	procSetForm            = winspool.NewProc("SetFormW")
	procShellExecute       = shell32.NewProc("ShellExecuteW")
	procShellExecuteEx     = shell32.NewProc("ShellExecuteExW")
	procSHChangeNotify     = shell32.NewProc("SHChangeNotify")
	procKnownFolderPath    = shell32.NewProc("SHGetKnownFolderPath")
	procCoTaskMemFree      = ole32.NewProc("CoTaskMemFree")
)

type printerInfo4 struct {
	PrinterName *uint16
	ServerName  *uint16
	Attributes  uint32
}

type docInfo1 struct {
	DocName    *uint16
	OutputFile *uint16
	DataType   *uint16
}

type printerDefaults struct {
	DataType      *uint16
	DevMode       uintptr
	DesiredAccess uint32
}

type sizeL struct {
	CX int32
	CY int32
}

type rectL struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type formInfo1 struct {
	Flags         uint32
	Name          *uint16
	Size          sizeL
	ImageableArea rectL
}

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type shellExecuteInfo struct {
	Size          uint32
	Mask          uint32
	Window        uintptr
	Verb          *uint16
	File          *uint16
	Parameters    *uint16
	Directory     *uint16
	Show          int32
	Instance      uintptr
	IDList        uintptr
	Class         *uint16
	ClassKey      uintptr
	HotKey        uint32
	IconOrMonitor uintptr
	Process       uintptr
}

func prepareConsole() {
	window, _, _ := procGetConsoleWindow.Call()
	if window == 0 {
		allocated, _, _ := procAllocConsole.Call()
		if allocated == 0 {
			return
		}
	}
	if output, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout = output
		os.Stderr = output
	}
	if input, err := os.OpenFile("CONIN$", os.O_RDONLY, 0); err == nil {
		os.Stdin = input
	}
}

func platformDataDir() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return "", errors.New("LOCALAPPDATA is unavailable")
	}
	return filepath.Join(base, "TotalPolyPrint", "EpsonPrint"), nil
}

func downloadsDir() (string, error) {
	folder := guid{Data1: 0x374DE290, Data2: 0x123F, Data3: 0x4565, Data4: [8]byte{0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B}}
	var raw *uint16
	result, _, callErr := procKnownFolderPath.Call(uintptr(unsafe.Pointer(&folder)), 0, 0, uintptr(unsafe.Pointer(&raw)))
	if int32(result) == 0 && raw != nil {
		defer procCoTaskMemFree.Call(uintptr(unsafe.Pointer(raw)))
		return syscall.UTF16ToString((*[1 << 20]uint16)(unsafe.Pointer(raw))[:]), nil
	}
	profile := os.Getenv("USERPROFILE")
	if profile == "" {
		return "", fmt.Errorf("Windows Downloads folder is unavailable: %v", callErr)
	}
	return filepath.Join(profile, "Downloads"), nil
}

func listPrinters() ([]string, error) {
	flags := uintptr(printerEnumLocal | printerEnumConnections)
	var needed, returned uint32
	_, _, firstErr := procEnumPrinters.Call(flags, 0, 4, 0, 0, uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&returned)))
	if needed == 0 {
		if firstErr != syscall.ERROR_INSUFFICIENT_BUFFER && firstErr != syscall.Errno(0) {
			return nil, firstErr
		}
		return []string{}, nil
	}
	buffer := make([]byte, needed)
	ok, _, callErr := procEnumPrinters.Call(flags, 0, 4, uintptr(unsafe.Pointer(&buffer[0])), uintptr(needed), uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&returned)))
	if ok == 0 {
		return nil, callErr
	}
	if returned == 0 {
		return []string{}, nil
	}
	records := unsafe.Slice((*printerInfo4)(unsafe.Pointer(&buffer[0])), returned)
	result := make([]string, 0, returned)
	for _, record := range records {
		if record.PrinterName != nil {
			result = append(result, syscall.UTF16ToString((*[1 << 20]uint16)(unsafe.Pointer(record.PrinterName))[:]))
		}
	}
	sortStringsCaseInsensitive(result)
	return result, nil
}

func sortStringsCaseInsensitive(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && strings.ToLower(values[j]) < strings.ToLower(values[j-1]); j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

func openPrinter(name string) (uintptr, error) {
	printerName, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	var handle uintptr
	ok, _, callErr := procOpenPrinter.Call(uintptr(unsafe.Pointer(printerName)), uintptr(unsafe.Pointer(&handle)), 0)
	if ok == 0 {
		return 0, callErr
	}
	return handle, nil
}

func probePrinter(name string) error {
	handle, err := openPrinter(name)
	if err != nil {
		return err
	}
	procClosePrinter.Call(handle)
	return nil
}

func sendRaw(printer string, payload []byte, documentName string) error {
	handle, err := openPrinter(printer)
	if err != nil {
		return err
	}
	defer procClosePrinter.Call(handle)
	docName, _ := syscall.UTF16PtrFromString(documentName)
	rawName, _ := syscall.UTF16PtrFromString("RAW")
	doc := docInfo1{DocName: docName, DataType: rawName}
	docID, _, callErr := procStartDocPrinter.Call(handle, 1, uintptr(unsafe.Pointer(&doc)))
	if docID == 0 {
		return callErr
	}
	documentStarted := true
	defer func() {
		if documentStarted {
			procEndDocPrinter.Call(handle)
		}
	}()
	pageOK, _, pageErr := procStartPagePrinter.Call(handle)
	if pageOK == 0 {
		return pageErr
	}
	pageStarted := true
	defer func() {
		if pageStarted {
			procEndPagePrinter.Call(handle)
		}
	}()
	remaining := payload
	for len(remaining) > 0 {
		var written uint32
		ok, _, writeErr := procWritePrinter.Call(handle, uintptr(unsafe.Pointer(&remaining[0])), uintptr(len(remaining)), uintptr(unsafe.Pointer(&written)))
		if ok == 0 {
			return writeErr
		}
		if written == 0 || int(written) > len(remaining) {
			return errors.New("Windows accepted an invalid byte count for the RAW print job")
		}
		remaining = remaining[written:]
	}
	pageEnded, _, pageEndErr := procEndPagePrinter.Call(handle)
	pageStarted = false
	if pageEnded == 0 {
		return pageEndErr
	}
	documentEnded, _, documentEndErr := procEndDocPrinter.Call(handle)
	documentStarted = false
	if documentEnded == 0 {
		return documentEndErr
	}
	return nil
}

func acquireSingleAgent() (func(), bool, error) {
	name, _ := syscall.UTF16PtrFromString("Local\\TotalPolyPrintEpsonHelper")
	handle, _, callErr := procCreateMutex.Call(0, 1, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return nil, false, callErr
	}
	if callErr == errorAlreadyExists {
		procCloseHandle.Call(handle)
		return func() {}, false, nil
	}
	return func() {
		procReleaseMutex.Call(handle)
		procCloseHandle.Call(handle)
	}, true, nil
}

func runReg(args ...string) error {
	command := exec.Command(filepath.Join(os.Getenv("WINDIR"), "System32", "reg.exe"), args...)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("reg.exe %s: %s", strings.Join(args, " "), strings.TrimSpace(string(output)))
	}
	return nil
}

func registerAutostart(exe string) error {
	value := fmt.Sprintf("\"%s\" --agent", exe)
	return runReg("add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "Total Poly Print Epson Helper", "/t", "REG_SZ", "/d", value, "/f")
}

func registerFileAssociation(exe string) error {
	commands := [][]string{
		{"add", `HKCU\Software\Classes\.tppprint`, "/ve", "/d", "TotalPolyPrint.PrintJob", "/f"},
		{"add", `HKCU\Software\Classes\.tppprint`, "/v", "Content Type", "/d", "application/vnd.totalpolyprint.epson-raw", "/f"},
		{"add", `HKCU\Software\Classes\TotalPolyPrint.PrintJob`, "/ve", "/d", "Total Poly Print Epson Dispatch Job", "/f"},
		{"add", `HKCU\Software\Classes\TotalPolyPrint.PrintJob\DefaultIcon`, "/ve", "/d", fmt.Sprintf("\"%s\",0", exe), "/f"},
		{"add", `HKCU\Software\Classes\TotalPolyPrint.PrintJob\shell\open\command`, "/ve", "/d", fmt.Sprintf("\"%s\" --print-file \"%%1\"", exe), "/f"},
	}
	for _, command := range commands {
		if err := runReg(command...); err != nil {
			return err
		}
	}
	return nil
}

func notifyAssociationChanged() {
	procSHChangeNotify.Call(shcneAssocChanged, shcnfIDList, 0, 0)
}

func unregisterAutostartAndAssociation() error {
	reg := filepath.Join(os.Getenv("WINDIR"), "System32", "reg.exe")
	commands := [][]string{
		{"delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "Total Poly Print Epson Helper", "/f"},
		{"delete", `HKCU\Software\Classes\.tppprint`, "/f"},
		{"delete", `HKCU\Software\Classes\TotalPolyPrint.PrintJob`, "/f"},
	}
	for _, args := range commands {
		_ = exec.Command(reg, args...).Run()
	}
	return nil
}

func unregisterLegacyStartup() error {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		return nil
	}
	legacy := filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Total Poly Print Epson Helper.vbs")
	if err := os.Remove(legacy); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func startAgent(exe string) error {
	command := exec.Command(exe, "--agent")
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow | detachedProcess}
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}

func processIdentity(pid int) (bool, string) {
	handle, _, _ := procOpenProcess.Call(processQueryLimited, 0, uintptr(pid))
	if handle == 0 {
		return false, ""
	}
	defer procCloseHandle.Call(handle)
	buffer := make([]uint16, 32768)
	size := uint32(len(buffer))
	ok, _, _ := procQueryProcessName.Call(handle, 0, uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size)))
	if ok == 0 {
		return true, ""
	}
	return true, filepath.Base(syscall.UTF16ToString(buffer[:size]))
}

func terminateProcess(pid int) error {
	handle, _, callErr := procOpenProcess.Call(processTerminate|processQueryLimited, 0, uintptr(pid))
	if handle == 0 {
		return callErr
	}
	defer procCloseHandle.Call(handle)
	ok, _, terminateErr := procTerminateProcess.Call(handle, 0)
	if ok == 0 {
		return terminateErr
	}
	return nil
}

func ensurePaperForm() error {
	var server uintptr
	defaults := printerDefaults{DesiredAccess: printerAccessAdminister}
	ok, _, openErr := procOpenPrinter.Call(0, uintptr(unsafe.Pointer(&server)), uintptr(unsafe.Pointer(&defaults)))
	if ok == 0 {
		return openErr
	}
	defer procClosePrinter.Call(server)
	name, _ := syscall.UTF16PtrFromString("TPP 15x5.5")
	form := formInfo1{
		Name:          name,
		Size:          sizeL{CX: 381000, CY: 139700},
		ImageableArea: rectL{Left: 0, Top: 0, Right: 381000, Bottom: 139700},
	}
	added, _, addErr := procAddForm.Call(server, 1, uintptr(unsafe.Pointer(&form)))
	if added != 0 {
		return nil
	}
	if addErr == errorFileExists || addErr == errorAlreadyExists {
		updated, _, updateErr := procSetForm.Call(server, uintptr(unsafe.Pointer(name)), 1, uintptr(unsafe.Pointer(&form)))
		if updated == 0 {
			return updateErr
		}
		return nil
	}
	return addErr
}

func installSignedDriversElevated(directory string) error {
	if os.Getenv("WINDIR") == "" {
		return errors.New("WINDIR is unavailable")
	}
	pnputil := filepath.Join(os.Getenv("WINDIR"), "System32", "pnputil.exe")
	return runElevatedProcessAndWait(pnputil, "/add-driver", filepath.Join(directory, "*.inf"), "/subdirs", "/install")
}

func runElevatedProcessAndWait(executable string, arguments ...string) error {
	verb, _ := syscall.UTF16PtrFromString("runas")
	file, _ := syscall.UTF16PtrFromString(executable)
	parameters, _ := syscall.UTF16PtrFromString(windowsCommandLine(arguments))
	info := shellExecuteInfo{Size: uint32(unsafe.Sizeof(shellExecuteInfo{})), Mask: seeMaskNoCloseProcess, Verb: verb, File: file, Parameters: parameters, Show: swShowNormal}
	ok, _, callErr := procShellExecuteEx.Call(uintptr(unsafe.Pointer(&info)))
	if ok == 0 {
		return callErr
	}
	defer procCloseHandle.Call(info.Process)
	procWaitForSingle.Call(info.Process, 120000)
	var exitCode uint32
	if result, _, exitErr := procGetExitCodeProcess.Call(info.Process, uintptr(unsafe.Pointer(&exitCode))); result == 0 {
		return exitErr
	}
	if exitCode != 0 {
		return fmt.Errorf("administrator step exited with code %d", exitCode)
	}
	return nil
}

func windowsCommandLine(arguments []string) string {
	quoted := make([]string, 0, len(arguments))
	for _, argument := range arguments {
		quoted = append(quoted, syscall.EscapeArg(argument))
	}
	return strings.Join(quoted, " ")
}

func replaceFileAtomic(source, destination string) error {
	from, err := syscall.UTF16PtrFromString(source)
	if err != nil {
		return err
	}
	to, err := syscall.UTF16PtrFromString(destination)
	if err != nil {
		return err
	}
	ok, _, callErr := procMoveFileEx.Call(
		uintptr(unsafe.Pointer(from)),
		uintptr(unsafe.Pointer(to)),
		moveFileReplaceExisting|moveFileWriteThrough,
	)
	if ok == 0 {
		return callErr
	}
	return nil
}

func runElevatedAndWait(exe, argument string) error {
	verb, _ := syscall.UTF16PtrFromString("runas")
	file, _ := syscall.UTF16PtrFromString(exe)
	parameters, _ := syscall.UTF16PtrFromString(argument)
	info := shellExecuteInfo{Size: uint32(unsafe.Sizeof(shellExecuteInfo{})), Mask: seeMaskNoCloseProcess, Verb: verb, File: file, Parameters: parameters, Show: swShowNormal}
	ok, _, callErr := procShellExecuteEx.Call(uintptr(unsafe.Pointer(&info)))
	if ok == 0 {
		return callErr
	}
	defer procCloseHandle.Call(info.Process)
	procWaitForSingle.Call(info.Process, 120000)
	var exitCode uint32
	if result, _, exitErr := procGetExitCodeProcess.Call(info.Process, uintptr(unsafe.Pointer(&exitCode))); result == 0 {
		return exitErr
	}
	if exitCode != 0 {
		return fmt.Errorf("administrator step exited with code %d", exitCode)
	}
	return nil
}

func openURL(url string) error {
	verb, _ := syscall.UTF16PtrFromString("open")
	target, _ := syscall.UTF16PtrFromString(url)
	result, _, callErr := procShellExecute.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)), 0, 0, swShowNormal)
	if result <= 32 {
		return callErr
	}
	return nil
}
