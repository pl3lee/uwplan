export interface WorkerEnvironment {
  ALLOWED_HOSTS?: string;
  BOOTSTRAP_GENERATION?: string;
  BOOTSTRAP_TOKEN_SHA256?: string;
  CONTROL_TOKEN_SHA256?: string;
  BYPASS_COORDINATOR?: any;
}

export function createMaintenanceWorker(options?: {
  fetchImpl?: (request: Request) => Promise<Response>;
}): {
  fetch(request: Request, env: WorkerEnvironment): Promise<Response>;
};

export class OperatorBypassCoordinator {
  constructor(state: any);
  fetch(request: Request): Promise<Response>;
}

declare const worker: ReturnType<typeof createMaintenanceWorker>;
export default worker;
