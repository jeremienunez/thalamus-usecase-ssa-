import type { FastifyInstance } from "fastify";
import type { SimHttpTransport, SimHttpRequest } from "@interview/sweep";

type InjectResponse = {
  statusCode: number;
  payload: string;
};

function buildUrl(path: string, query?: SimHttpRequest["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs.length > 0 ? `${path}?${qs}` : path;
}

export function createSimRouteTransport(app: FastifyInstance): SimHttpTransport {
  return {
    async request(input) {
      const response = await new Promise<InjectResponse>((resolve, reject) => {
        app.inject(
          {
            method: input.method,
            url: buildUrl(input.path, input.query),
            headers: input.headers,
            payload: input.json as string | object | Buffer | undefined,
          },
          (err, res) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(res);
          },
        );
      });

      if (response.payload.length === 0) {
        return { status: response.statusCode, body: {} };
      }

      try {
        return {
          status: response.statusCode,
          body: JSON.parse(response.payload) as unknown,
        };
      } catch {
        return {
          status: response.statusCode,
          body: response.payload,
        };
      }
    },
  };
}
