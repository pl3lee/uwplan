package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pl3lee/uwplan/internal/repository/user"
)

func TestLoginHandler(t *testing.T) {
	// Create a test router with mock config
	config := AuthConfig{
		UserRepo:           &user.Queries{}, // Mock this in real tests
		BaseURL:            "http://localhost:8080",
		GoogleClientID:     "test-client-id",
		GoogleClientSecret: "test-client-secret",
	}
	router := NewRouter(config)

	// Create test request
	req, err := http.NewRequest("POST", "/login", nil)
	if err != nil {
		t.Fatal(err)
	}

	// Create test response recorder
	rr := httptest.NewRecorder()

	// Call the handler
	router.handleLogin(rr, req)

	// Check the status code
	if status := rr.Code; status != http.StatusOK {
		t.Errorf("handler returned wrong status code: got %v want %v",
			status, http.StatusOK)
	}

	// Check if response contains expected content
	expected := "Login endpoint"
	if !contains(rr.Body.String(), expected) {
		t.Errorf("handler returned unexpected body: got %v want to contain %v",
			rr.Body.String(), expected)
	}
}

// Helper function to check if string contains substring
func contains(s, substr string) bool {
	return len(s) >= len(substr) &&
		(s == substr ||
			(len(s) > len(substr) &&
				(s[:len(substr)] == substr ||
					s[len(s)-len(substr):] == substr ||
					containsHelper(s, substr))))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
