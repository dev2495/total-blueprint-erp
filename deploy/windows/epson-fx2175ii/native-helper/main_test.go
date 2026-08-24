package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestValidateJobAcceptsOnlyApprovedContract(t *testing.T) {
	valid := testJob()
	payload, err := validateJob(valid)
	if err != nil {
		t.Fatalf("valid test job was rejected: %v", err)
	}
	if !bytes.HasPrefix(payload, requiredPrefix) {
		t.Fatal("validated payload lost the required ESC/P prefix")
	}
	if payload[len(payload)-1] != 12 {
		t.Fatal("validated payload lost its final form feed")
	}

	tests := map[string][]byte{
		"wrong header":   bytes.Replace(valid, []byte("EPSON-FX-2175II"), []byte("OTHER-PRINTER"), 1),
		"wrong paper":    bytes.Replace(valid, []byte("paper=15x5.5"), []byte("paper=A4"), 1),
		"wrong controls": append([]byte(expectedHeader+"\n\nnot-escp\r\n"), 12),
		"no form feed":   bytes.TrimSuffix(valid, []byte{12}),
		"too large":      bytes.Repeat([]byte{'x'}, maxJobBytes+1),
	}
	for name, job := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := validateJob(job); err == nil {
				t.Fatalf("%s job was accepted", name)
			}
		})
	}
}

func TestChooseEpsonPrinterPrefersExact2175IIQueue(t *testing.T) {
	printers := []string{
		"Microsoft Print to PDF",
		"EPSON FX-2175 (Copy 1)",
		"EPSON FX-2175II (Warehouse)",
		"EPSON FX-2175II",
	}
	if got := chooseEpsonPrinter(printers); got != "EPSON FX-2175II" {
		t.Fatalf("selected %q instead of the exact FX-2175II queue", got)
	}

	if got := chooseEpsonPrinter([]string{"EPSON FX-2175 (Copy 1)"}); got != "EPSON FX-2175 (Copy 1)" {
		t.Fatalf("compatible fallback was not selected: %q", got)
	}
	if got := chooseEpsonPrinter([]string{"Epson L3250", "Microsoft Print to PDF"}); got != "" {
		t.Fatalf("unrelated printer was selected: %q", got)
	}
}

func TestPathWithinRestrictsJobsToDownloads(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "dispatch-slip.tppprint")
	nested := filepath.Join(root, "ERP", "dispatch-slip.TPPPRINT")
	outside := filepath.Join(filepath.Dir(root), "dispatch-slip.tppprint")

	for _, path := range []string{inside, nested} {
		if !pathWithin(path, root) {
			t.Fatalf("Downloads job was rejected: %s", path)
		}
	}
	for _, path := range []string{outside, filepath.Join(root, "dispatch-slip.doc"), root} {
		if pathWithin(path, root) {
			t.Fatalf("unsafe job path was accepted: %s", path)
		}
	}
}

func TestExtractZipSafely(t *testing.T) {
	t.Run("extracts ordinary files", func(t *testing.T) {
		archive := filepath.Join(t.TempDir(), "driver.zip")
		writeTestZip(t, archive, map[string]string{"driver/package.inf": "signed-driver-placeholder"})
		destination := filepath.Join(t.TempDir(), "out")
		if err := extractZipSafely(archive, destination); err != nil {
			t.Fatalf("safe archive failed: %v", err)
		}
		payload, err := os.ReadFile(filepath.Join(destination, "driver", "package.inf"))
		if err != nil || string(payload) != "signed-driver-placeholder" {
			t.Fatalf("extracted payload mismatch: %q, %v", payload, err)
		}
	})

	t.Run("rejects traversal", func(t *testing.T) {
		archive := filepath.Join(t.TempDir(), "driver.zip")
		writeTestZip(t, archive, map[string]string{"../outside.inf": "unsafe"})
		if err := extractZipSafely(archive, filepath.Join(t.TempDir(), "out")); err == nil {
			t.Fatal("archive traversal was accepted")
		}
	})
}

func TestWriteJSONAtomicReplacesExistingStatus(t *testing.T) {
	path := filepath.Join(t.TempDir(), "status.json")
	if err := writeJSONAtomic(path, map[string]string{"state": "first"}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONAtomic(path, map[string]string{"state": "second"}); err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload), `"state": "second"`) {
		t.Fatalf("status was not replaced: %s", payload)
	}
}

func TestPreexistingJobsAreQuarantinedWithoutPrinting(t *testing.T) {
	downloads := t.TempDir()
	stateDir := t.TempDir()
	p := appPaths{Failed: filepath.Join(stateDir, "Failed")}
	if err := os.MkdirAll(p.Failed, 0o755); err != nil {
		t.Fatal(err)
	}

	cutoff := time.Now()
	oldJob := filepath.Join(downloads, "old-dispatch.tppprint")
	newJob := filepath.Join(downloads, "new-dispatch.tppprint")
	for _, path := range []string{oldJob, newJob} {
		if err := os.WriteFile(path, testJob(), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chtimes(oldJob, cutoff.Add(-time.Hour), cutoff.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(newJob, cutoff.Add(time.Hour), cutoff.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	quarantined, retained := quarantinePreexistingJobs(downloads, config{InstalledAt: cutoff}, p)
	if quarantined != 1 || retained != 0 {
		t.Fatalf("unexpected quarantine result: moved=%d retained=%d", quarantined, retained)
	}
	if _, err := os.Stat(oldJob); !os.IsNotExist(err) {
		t.Fatalf("old job remained in Downloads: %v", err)
	}
	if _, err := os.Stat(newJob); err != nil {
		t.Fatalf("new job was moved: %v", err)
	}
	failed, err := filepath.Glob(filepath.Join(p.Failed, "preinstall-review-*-old-dispatch.tppprint"))
	if err != nil || len(failed) != 1 {
		t.Fatalf("old job was not retained for review: %v, %v", failed, err)
	}
}

func writeTestZip(t *testing.T, path string, files map[string]string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	for name, payload := range files {
		writer, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte(payload)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}
