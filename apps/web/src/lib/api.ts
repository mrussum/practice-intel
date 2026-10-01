import { z } from "zod";
import {
  ApiError,
  Me,
  type Credentials,
  DocumentDetail,
  DocumentSummary,
  FitRow,
  ReadyResponse,
  type DocumentKind,
} from "@career-intel/shared";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Fetches, turns ApiError bodies into readable errors, and validates the response shape. */
async function request<T>(path: string, schema: z.ZodType<T> | null, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // The session cookie is httpOnly and set by the API's origin: it has to be
    // sent explicitly on cross-origin requests.
    res = await fetch(`${API_URL}${path}`, { credentials: "include", ...init });
  } catch {
    throw new RequestError("Can't reach the API. Is it running?", 0);
  }
  if (!res.ok) {
    const body = ApiError.safeParse(await res.json().catch(() => null));
    throw new RequestError(body.success ? body.data.message : `Request failed (HTTP ${res.status}).`, res.status, body.data?.error);
  }
  if (!schema) return undefined as T;
  return schema.parse(await res.json());
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  ready: () => request("/ready", ReadyResponse),
  me: () => request("/auth/me", Me),
  signup: (c: Credentials) => request("/auth/signup", Me, json(c)),
  login: (c: Credentials) => request("/auth/login", Me, json(c)),
  logout: () => request("/auth/logout", null, { method: "POST" }),
  listDocuments: () => request("/documents", z.array(DocumentSummary)),
  getDocument: (id: string) => request(`/documents/${id}`, DocumentDetail),
  deleteDocument: (id: string) => request(`/documents/${id}`, null, { method: "DELETE" }),
  uploadDocument: (kind: DocumentKind, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request(`/documents?kind=${kind}`, DocumentSummary, { method: "POST", body: form });
  },
  getFit: (jobId: string) => request(`/jobs/${jobId}/fit`, z.array(FitRow)),
};
