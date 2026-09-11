package uwflow_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	gateway "github.com/pl3lee/uwplan/api/internal/gateway/uwflow"
)

func TestUWFlowFetchCombinesRatingsAndDetails(t *testing.T) {
	t.Parallel()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request struct {
			OperationName string         `json:"operationName"`
			Variables     map[string]any `json:"variables"`
			Query         string         `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if request.OperationName == "exploreAll" {
			if diff := cmp.Diff("query exploreAll { course_search_index { ...CourseSearch __typename } } fragment CourseSearch on course_search_index { course_id name code useful ratings liked easy __typename }", request.Query); diff != "" {
				t.Error(diff)
			}
			w.Write([]byte(`{"data":{"course_search_index":[{"course_id":1,"code":"cs135","name":"Functional Programs","useful":0.8,"liked":null,"easy":0.5,"ratings":12}]}}`))
			return
		}
		if diff := cmp.Diff(map[string]any{"code": "cs135"}, request.Variables); diff != "" {
			t.Error(diff)
		}
		if diff := cmp.Diff("getCourse", request.OperationName); diff != "" {
			t.Error(diff)
		}
		if diff := cmp.Diff("query getCourse($code: String) { course(where: {code: {_eq: $code}}) { id code name description antireqs prereqs coreqs __typename }}", request.Query); diff != "" {
			t.Error(diff)
		}
		w.Write([]byte(`{"data":{"course":[{"id":1,"code":"cs135","name":"Functional Programs","description":"Recursion","prereqs":"Prerequisite","antireqs":"Antirequisite","coreqs":"Corequisite"}]}}`))
	}))
	t.Cleanup(server.Close)
	got, err := gateway.NewUWFlowGateway(server.URL, server.Client()).Fetch(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	useful, easy := "0.8", "0.5"
	count := int32(12)
	want := course.Import{Courses: []course.Course{{Code: "cs135", Name: "Functional Programs", Description: "Recursion", Prereqs: "Prerequisite", Antireqs: "Antirequisite", Coreqs: "Corequisite", UsefulRating: &useful, EasyRating: &easy, NumRatings: &count}}}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff(int32(2), calls.Load()); diff != "" {
		t.Fatal(diff)
	}
}

func TestUWFlowRejectsIncompleteCatalogsAndDoesNotRetryAccessDenial(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"access denied", 403, `{"error":"denied"}`},
		{"graphql failure", 200, `{"errors":[{"message":"failed"}],"data":{"course_search_index":[]}}`},
		{"missing catalog", 200, `{"data":{}}`},
		{"empty catalog", 200, `{"data":{"course_search_index":[]}}`},
		{"invalid json", 200, `broken`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			t.Cleanup(server.Close)
			got, err := gateway.NewUWFlowGateway(server.URL, server.Client()).Fetch(t.Context())
			if err == nil {
				t.Fatal("expected upstream failure")
			}
			if diff := cmp.Diff(course.Import{}, got); diff != "" {
				t.Fatal(diff)
			}
			if diff := cmp.Diff(int32(1), calls.Load()); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestUWFlowRetryStopsWhenContextExpires(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	t.Cleanup(server.Close)
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	_, err := gateway.NewUWFlowGateway(server.URL, server.Client()).Fetch(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v", err)
	}
}

func TestUWFlowRejectsMissingOrMismatchedDetails(t *testing.T) {
	t.Parallel()
	for _, body := range []string{
		`{"data":{"course":[]}}`,
		`{"errors":[{"message":"partial failure"}],"data":{"course":[]}}`,
		`{"data":{"course":[{"id":2,"code":"cs135","description":"","prereqs":"","antireqs":"","coreqs":""}]}}`,
		`{"data":{"course":[{"id":1,"code":"cs135","prereqs":"","antireqs":"","coreqs":""}]}}`,
	} {
		t.Run(body, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Operation string `json:"operationName"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				if request.Operation == "exploreAll" {
					w.Write([]byte(`{"data":{"course_search_index":[{"course_id":1,"code":"cs135","name":"Functional Programs","ratings":0}]}}`))
					return
				}
				w.Write([]byte(body))
			}))
			t.Cleanup(server.Close)
			got, err := gateway.NewUWFlowGateway(server.URL, server.Client()).Fetch(t.Context())
			if err == nil {
				t.Fatal("expected incomplete details to reject the import")
			}
			if diff := cmp.Diff(course.Import{}, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestUWFlowRetriesTransientFailureAndBoundsParallelRequests(t *testing.T) {
	t.Parallel()
	var indexCalls, active, maximum atomic.Int32
	index := []map[string]any{}
	want := course.Import{Courses: []course.Course{}}
	count := int32(0)
	for i := 1; i <= 12; i++ {
		code := fmt.Sprintf("cs%d", 100+i)
		index = append(index, map[string]any{"course_id": i, "code": code, "name": "Course", "ratings": 0})
		want.Courses = append(want.Courses, course.Course{Code: code, Name: "Course", NumRatings: &count})
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Operation string `json:"operationName"`
			Variables struct {
				Code string `json:"code"`
			} `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		if request.Operation == "exploreAll" {
			if indexCalls.Add(1) == 1 {
				w.WriteHeader(503)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"course_search_index": index}})
			return
		}
		current := active.Add(1)
		defer active.Add(-1)
		for {
			previous := maximum.Load()
			if current <= previous || maximum.CompareAndSwap(previous, current) {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
		var number int
		if _, err := fmt.Sscanf(request.Variables.Code, "cs%d", &number); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"course": []any{map[string]any{"id": number - 100, "code": request.Variables.Code, "description": nil, "prereqs": nil, "antireqs": nil, "coreqs": nil}}}})
	}))
	t.Cleanup(server.Close)
	got, err := gateway.NewUWFlowGateway(server.URL, server.Client()).Fetch(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff(int32(2), indexCalls.Load()); diff != "" {
		t.Fatal(diff)
	}
	if maximum.Load() < 2 || maximum.Load() > 8 {
		t.Fatalf("parallel requests=%d", maximum.Load())
	}
}
