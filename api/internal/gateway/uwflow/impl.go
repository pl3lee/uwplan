package uwflow

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/pl3lee/uwplan/api/internal/domain/course"
)

const DefaultEndpoint = "https://uwflow.com/graphql"
const searchQuery = "query exploreAll { course_search_index { ...CourseSearch __typename } } fragment CourseSearch on course_search_index { course_id name code useful ratings liked easy __typename }"
const detailQuery = "query getCourse($code: String) { course(where: {code: {_eq: $code}}) { id code name description antireqs prereqs coreqs __typename }}"

type UWFlowGatewayImpl struct {
	endpoint string
	client   *http.Client
}

func NewUWFlowGateway(endpoint string, client *http.Client) *UWFlowGatewayImpl {
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &UWFlowGatewayImpl{endpoint: endpoint, client: client}
}

type searchCourse struct {
	ID      int64        `json:"course_id"`
	Code    string       `json:"code"`
	Name    string       `json:"name"`
	Useful  *json.Number `json:"useful"`
	Liked   *json.Number `json:"liked"`
	Easy    *json.Number `json:"easy"`
	Ratings *int32       `json:"ratings"`
}

// Metadata can be explicitly null in upstream records, but an omitted field
// means the response is incomplete and must not erase existing catalog values.
type metadataText struct {
	value   string
	present bool
}

func (m *metadataText) UnmarshalJSON(data []byte) error {
	m.present = true
	if string(data) == "null" {
		return nil
	}
	return json.Unmarshal(data, &m.value)
}

type detailCourse struct {
	ID          int64        `json:"id"`
	Code        string       `json:"code"`
	Description metadataText `json:"description"`
	Prereqs     metadataText `json:"prereqs"`
	Antireqs    metadataText `json:"antireqs"`
	Coreqs      metadataText `json:"coreqs"`
}

func (g *UWFlowGatewayImpl) request(ctx context.Context, operation, query string, variables map[string]any, destination any) error {
	encoded, err := json.Marshal(struct {
		OperationName string         `json:"operationName"`
		Variables     map[string]any `json:"variables"`
		Query         string         `json:"query"`
	}{operation, variables, query})
	if err != nil {
		return fmt.Errorf("encode UWFlow request: %w", err)
	}
	for attempt := 0; attempt < 4; attempt++ {
		if attempt > 0 {
			timer := time.NewTimer(250 * time.Millisecond * time.Duration(1<<(attempt-1)))
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, g.endpoint, bytes.NewReader(encoded))
		if err != nil {
			return fmt.Errorf("prepare UWFlow request: %w", err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Accept", "application/json")
		request.Header.Set("User-Agent", "UWPlan-Catalog/1.0")
		response, err := g.client.Do(request)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if attempt == 3 {
				return fmt.Errorf("request UWFlow: %w", err)
			}
			continue
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			response.Body.Close()
			if attempt < 3 && (response.StatusCode == 429 || response.StatusCode >= 500) {
				continue
			}
			return fmt.Errorf("UWFlow response status %d", response.StatusCode)
		}
		const maximumBody = 16 << 20
		body, err := io.ReadAll(io.LimitReader(response.Body, maximumBody+1))
		response.Body.Close()
		if err != nil {
			return fmt.Errorf("read UWFlow response: %w", err)
		}
		if len(body) > maximumBody {
			return fmt.Errorf("UWFlow response exceeds size limit")
		}
		if err := json.Unmarshal(body, destination); err != nil {
			return fmt.Errorf("decode UWFlow response: %w", err)
		}
		return nil
	}
	return fmt.Errorf("UWFlow request failed")
}

func (g *UWFlowGatewayImpl) Fetch(ctx context.Context) (course.Import, error) {
	var index struct {
		Data *struct {
			Courses []searchCourse `json:"course_search_index"`
		} `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	if err := g.request(ctx, "exploreAll", searchQuery, map[string]any{}, &index); err != nil {
		return course.Import{}, err
	}
	if len(index.Errors) > 0 || index.Data == nil || len(index.Data.Courses) == 0 {
		return course.Import{}, fmt.Errorf("UWFlow catalog is incomplete")
	}
	for _, item := range index.Data.Courses {
		if item.ID <= 0 || strings.TrimSpace(item.Code) == "" || strings.TrimSpace(item.Name) == "" {
			return course.Import{}, fmt.Errorf("UWFlow catalog entry is incomplete")
		}
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	result := course.Import{Courses: make([]course.Course, len(index.Data.Courses))}
	jobs := make(chan int)
	failures := make(chan error, 1)
	var workers sync.WaitGroup
	for range min(8, len(index.Data.Courses)) {
		workers.Go(func() {
			for position := range jobs {
				value, err := g.details(ctx, index.Data.Courses[position])
				if err != nil {
					select {
					case failures <- err:
					default:
					}
					cancel()
					return
				}
				result.Courses[position] = value
			}
		})
	}
dispatch:
	for index := range index.Data.Courses {
		select {
		case jobs <- index:
		case <-ctx.Done():
			break dispatch
		}
	}
	close(jobs)
	workers.Wait()
	select {
	case err := <-failures:
		return course.Import{}, err
	default:
	}
	if err := ctx.Err(); err != nil {
		return course.Import{}, err
	}
	return result, nil
}

func (g *UWFlowGatewayImpl) details(ctx context.Context, item searchCourse) (course.Course, error) {
	var result struct {
		Data *struct {
			Courses []detailCourse `json:"course"`
		} `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	if err := g.request(ctx, "getCourse", detailQuery, map[string]any{"code": strings.ToLower(item.Code)}, &result); err != nil {
		return course.Course{}, err
	}
	if len(result.Errors) > 0 || result.Data == nil || len(result.Data.Courses) != 1 {
		return course.Course{}, fmt.Errorf("UWFlow course details are incomplete")
	}
	detail := result.Data.Courses[0]
	if detail.ID != item.ID || !strings.EqualFold(detail.Code, item.Code) || !detail.Description.present || !detail.Prereqs.present || !detail.Antireqs.present || !detail.Coreqs.present {
		return course.Course{}, fmt.Errorf("UWFlow course details do not match the catalog")
	}
	return course.Course{Code: item.Code, Name: item.Name, Description: detail.Description.value, Prereqs: detail.Prereqs.value, Antireqs: detail.Antireqs.value, Coreqs: detail.Coreqs.value, UsefulRating: ratingText(item.Useful), LikedRating: ratingText(item.Liked), EasyRating: ratingText(item.Easy), NumRatings: item.Ratings}, nil
}

func ratingText(value *json.Number) *string {
	if value == nil {
		return nil
	}
	text := string(*value)
	return &text
}
