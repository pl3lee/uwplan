package health

type State string

const (
	Available   State = "available"
	Unavailable State = "unavailable"
)

type Report struct{ Database, Redis State }

func (r Report) Ready() bool { return r.Database == Available && r.Redis == Available }

type Release struct{ Digest, Revision string }
