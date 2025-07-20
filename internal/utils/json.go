package utils

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

// ErrorResponse represents the structure of error responses
type ErrorResponse struct {
	Error string `json:"error" example:"Invalid input"`
}

func RespondWithError(w http.ResponseWriter, code int, msg string, err error) {
	if err != nil {
		log.Println(err)
	}
	if code > 499 {
		log.Printf("Responding with 5XX error: %s", msg)
	}
	RespondWithJSON(w, code, ErrorResponse{
		Error: msg,
	})
}

func RespondWithJSON(w http.ResponseWriter, code int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	if code == http.StatusNoContent {
		w.WriteHeader(code)
		return
	}
	dat, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Error marshalling JSON: %s", err)
		w.WriteHeader(500)
		return
	}
	w.WriteHeader(code)
	_, err = w.Write(dat)
	if err != nil {
		log.Printf("Write failed: %v", err)
	}
}

func DecodeRequest[T any](r *http.Request, result *T) error {
	if r == nil {
		return fmt.Errorf("DecodeRequest: nil request")
	}

	if err := json.NewDecoder(r.Body).Decode(result); err != nil {
		return fmt.Errorf("DecodeRequest: failed to decode request: %w", err)
	}

	return nil
}
