const candidateDatabasePattern = /^uwplan_candidate_[0-9]{8}T[0-9]{9}Z$/;

export function resolveAuthRehearsalBoundaryConfiguration(
  environment: NodeJS.ProcessEnv,
) {
  if (
    environment.UWPLAN_AUTH_REHEARSAL_ENABLED !== "true" ||
    environment.UWPLAN_DEPLOYMENT_ENVIRONMENT !== "rehearsal" ||
    environment.AUTH_TRUST_HOST !== "true" ||
    Object.hasOwn(environment, "AUTH_URL")
  ) {
    return null;
  }

  try {
    const databaseUrl = new URL(environment.DATABASE_URL ?? "");
    const publicUrl = new URL(environment.UWPLAN_REHEARSAL_PUBLIC_URL ?? "");
    const database = decodeURIComponent(databaseUrl.pathname.slice(1));
    if (
      databaseUrl.protocol !== "postgresql:" ||
      decodeURIComponent(databaseUrl.username) !== "uwplan_app" ||
      !candidateDatabasePattern.test(database) ||
      publicUrl.protocol !== "https:" ||
      publicUrl.username ||
      publicUrl.password ||
      publicUrl.pathname !== "/" ||
      publicUrl.search ||
      publicUrl.hash
    ) {
      return null;
    }
    return { hostname: publicUrl.hostname, database };
  } catch {
    return null;
  }
}
