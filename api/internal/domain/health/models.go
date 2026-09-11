package health

import "regexp"

type State string

const (
	Available   State = "available"
	Unavailable State = "unavailable"
)

type Report struct{ Database, Redis State }

func (r Report) Ready() bool { return r.Database == Available && r.Redis == Available }

type Release struct{ Digest, Revision string }

var digestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var revisionPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,128}$`)

// Public returns the safe release identity and whether both original values
// were valid. It preserves the deployed readiness and redaction contract.
func (r Release) Public() (Release, bool) {
	digestValid := digestPattern.MatchString(r.Digest)
	revisionValid := revisionPattern.MatchString(r.Revision)
	if !digestValid {
		r.Digest = "unavailable"
	}
	if !revisionValid {
		r.Revision = "unknown"
	}
	return r, digestValid && revisionValid
}
