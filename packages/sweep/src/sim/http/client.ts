export type SimHttpMethod = "GET" | "POST" | "PATCH";

export interface SimHttpRequest {
  method: SimHttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  json?: unknown;
  headers?: Record<string, string>;
}

export interface SimHttpResponse {
  status: number;
  body: unknown;
}

export interface SimHttpTransport {
  request(input: SimHttpRequest): Promise<SimHttpResponse>;
}

export class SimHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Sim HTTP request failed with status ${status}`);
  }
}

export class SimHttpClient {
  constructor(private readonly transport: SimHttpTransport) {}

  async get<T>(
    path: string,
    opts?: {
      query?: SimHttpRequest["query"];
      headers?: SimHttpRequest["headers"];
    },
  ): Promise<T> {
    return this.request<T>({
      method: "GET",
      path,
      query: opts?.query,
      headers: opts?.headers,
    });
  }

  async post<T>(
    path: string,
    json?: unknown,
    opts?: { headers?: SimHttpRequest["headers"] },
  ): Promise<T> {
    return this.request<T>({
      method: "POST",
      path,
      json,
      headers: opts?.headers,
    });
  }

  async patch<T>(
    path: string,
    json?: unknown,
    opts?: { headers?: SimHttpRequest["headers"] },
  ): Promise<T> {
    return this.request<T>({
      method: "PATCH",
      path,
      json,
      headers: opts?.headers,
    });
  }

  private async request<T>(input: SimHttpRequest): Promise<T> {
    const response = await this.transport.request(input);
    if (response.status >= 400) {
      const body = response.body;
      const message =
        body &&
        typeof body === "object" &&
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : undefined;
      throw new SimHttpError(response.status, body, message);
    }
    return response.body as T;
  }
}
