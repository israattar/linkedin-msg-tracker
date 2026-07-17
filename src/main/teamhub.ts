// Minimal Team Hub API client, deliberately scoped to a single project:
// every endpoint this client can call lives under /project/{projectId}.
// It never touches hubs, users, chat, documents, or any other project.
//
// API reference: https://api.teamhub.com (OpenAPI v1). Bearer token auth,
// rate limited to 100 requests per minute per organisation.
const BASE_URL = 'https://api.teamhub.com/api/v1/integration';
const REQUEST_TIMEOUT_MS = 15_000;

export interface TeamhubSlot {
  id: string;
  title: string;
  kind?: string;
}

export interface TeamhubTask {
  id: string;
  title?: string;
  content?: string;
  slotId?: string;
  dueDate?: string;
  completed?: boolean;
}

export class TeamhubError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TeamhubError';
  }
}

export class TeamhubClient {
  constructor(
    private readonly apiKey: string,
    private readonly projectId: string,
  ) {}

  async getSlots(): Promise<TeamhubSlot[]> {
    return this.request<TeamhubSlot[]>('GET', `/project/${this.projectId}/slots`);
  }

  async listTasks(page: number, pageSize: number): Promise<TeamhubTask[]> {
    const query = `page=${page}&pageSize=${pageSize}&archived=false`;
    return this.request<TeamhubTask[]>('GET', `/project/${this.projectId}/tasks?${query}`);
  }

  async getTask(taskId: string): Promise<TeamhubTask> {
    return this.request<TeamhubTask>('GET', `/project/${this.projectId}/task/${taskId}`);
  }

  async createTask(body: Record<string, unknown>): Promise<TeamhubTask> {
    return this.request<TeamhubTask>('PUT', `/project/${this.projectId}/tasks`, body);
  }

  async updateTask(taskId: string, body: Record<string, unknown>): Promise<TeamhubTask> {
    return this.request<TeamhubTask>('PATCH', `/project/${this.projectId}/task/${taskId}`, body);
  }

  async moveTask(taskId: string, slotId: string): Promise<TeamhubTask> {
    return this.request<TeamhubTask>('PATCH', `/project/${this.projectId}/task/${taskId}/move`, {
      slotId,
      top: true,
    });
  }

  // Note: the spec's DELETE /project/{projectId} is ambiguously documented
  // (it may delete the project itself), so this client intentionally has no
  // delete method at all.

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TeamhubError(0, `Network error: ${reason}`);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new TeamhubError(
        response.status,
        `Team Hub responded ${response.status} for ${method} ${path}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}
