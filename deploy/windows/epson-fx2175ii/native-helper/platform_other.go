//go:build !windows

package main

import (
	"errors"
	"os"
	"path/filepath"
)

func prepareConsole() {}

func platformDataDir() (string, error) {
	if configured := os.Getenv("TPP_EPSON_TEST_DATA_DIR"); configured != "" {
		return configured, nil
	}
	return filepath.Join(os.TempDir(), "TotalPolyPrint", "EpsonPrint"), nil
}

func downloadsDir() (string, error) {
	if configured := os.Getenv("TPP_EPSON_TEST_DOWNLOADS_DIR"); configured != "" {
		return configured, nil
	}
	return filepath.Join(os.TempDir(), "Downloads"), nil
}

func listPrinters() ([]string, error)           { return nil, errors.New("Windows print spooler is unavailable") }
func probePrinter(string) error                 { return errors.New("Windows print spooler is unavailable") }
func sendRaw(string, []byte, string) error      { return errors.New("Windows print spooler is unavailable") }
func acquireSingleAgent() (func(), bool, error) { return func() {}, true, nil }
func registerAutostart(string) error            { return errors.New("Windows registry is unavailable") }
func registerFileAssociation(string) error      { return errors.New("Windows registry is unavailable") }
func unregisterAutostartAndAssociation() error  { return nil }
func unregisterLegacyStartup() error            { return nil }
func notifyAssociationChanged()                 {}
func startAgent(string) error                   { return errors.New("Windows process startup is unavailable") }
func processIdentity(int) (bool, string)        { return false, "" }
func terminateProcess(int) error                { return nil }
func ensurePaperForm() error                    { return errors.New("Windows print forms are unavailable") }
func runElevatedAndWait(string, string) error   { return errors.New("Windows elevation is unavailable") }
func openURL(string) error                      { return nil }
func installSignedDriversElevated(string) error {
	return errors.New("Windows driver installation is unavailable")
}
func replaceFileAtomic(source, destination string) error {
	return os.Rename(source, destination)
}
