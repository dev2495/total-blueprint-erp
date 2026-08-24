//go:build windows

package main

import "testing"

func TestLocalPrintServerUsesServerAdministratorAccess(t *testing.T) {
	// Windows SDK: SERVER_ACCESS_ADMINISTER is 0x1. The printer-level
	// PRINTER_ACCESS_ADMINISTER value is 0x4 and is invalid for the local print
	// server handle used by AddForm/SetForm.
	if serverAccessAdminister != 0x00000001 {
		t.Fatalf("unexpected SERVER_ACCESS_ADMINISTER value: %#x", serverAccessAdminister)
	}
}
