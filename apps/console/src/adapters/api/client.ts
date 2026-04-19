export interface ApiFetcher {
  getJson<T>(path: string): Promise<T>;
  postJson<TReq, TRes>(path: string, body: TReq | undefined): Promise<TRes>;
}

export interface FetchApiClientDeps {
  fetch?: typeof fetch;
  baseUrl?: string;
}

export function createFetchApiClient(deps: FetchApiClientDeps = {}): ApiFetcher {
  const f = deps.fetch ?? globalThis.fetch;
  const base = deps.baseUrl ?? "";

  async function getJson<T>(path: string): Promise<T> {
    const res = await f(base + path, undefined);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  async function postJson<TReq, TRes>(path: string, body: TReq | undefined): Promise<TRes> {
    const init: RequestInit =
      body === undefined
        ? { method: "POST" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          };
    const res = await f(base + path, init);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as TRes;
  }

  return { getJson, postJson };
}
