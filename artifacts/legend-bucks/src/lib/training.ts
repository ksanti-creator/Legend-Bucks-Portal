// Training mode: an isolated, dummy-data copy of the real portal.
// Mode is decided once per page load from the URL so entering or leaving
// always happens through a full reload with a fresh query cache.

import { getNormalSessionToken } from "./auth-token";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const TRAINING_LAUNCH_PATH = `${BASE}/training`;
export const TRAINING_PORTAL_BASE = `${BASE}/training/portal`;
export const TRAINING_API_BASE = "/api/training";
const TRAINING_TOKEN_KEY = "legend_bucks_training_session_token";
const TRAINING_PERSONA_KEY = "legend_bucks_training_persona";

function pathIsTrainingPortal(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname;
  return p === TRAINING_PORTAL_BASE || p.startsWith(`${TRAINING_PORTAL_BASE}/`);
}
export const IS_TRAINING = pathIsTrainingPortal();

export type PersonaKey = "admin" | "manager" | "employee" | "accounting" | "operator";
export type TrainingPersona = { key: string; label: string; role: string };
export type TrainingStatus = { enabled: boolean; available: boolean; seeded: boolean; reason: string };

export function getTrainingToken(): string | null {
  try { return sessionStorage.getItem(TRAINING_TOKEN_KEY); } catch { return null; }
}
export function getTrainingPersona(): TrainingPersona | null {
  try { const raw = sessionStorage.getItem(TRAINING_PERSONA_KEY); return raw ? JSON.parse(raw) as TrainingPersona : null; } catch { return null; }
}
export function clearTrainingSession(): void {
  try { sessionStorage.removeItem(TRAINING_TOKEN_KEY); sessionStorage.removeItem(TRAINING_PERSONA_KEY); } catch { /* ignore */ }
}
function saveTrainingSession(token: string, persona: TrainingPersona) {
  sessionStorage.setItem(TRAINING_TOKEN_KEY, token);
  sessionStorage.setItem(TRAINING_PERSONA_KEY, JSON.stringify(persona));
}

/** Full reloads keep live and training caches from ever sharing memory. */
export function goToTrainingLaunch(): void { window.location.assign(TRAINING_LAUNCH_PATH); }
export function exitTraining(): void { clearTrainingSession(); window.location.assign(`${BASE}/dashboard`); }

export class TrainingApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function launchRequest<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (auth) {
    const token = getNormalSessionToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${TRAINING_API_BASE}${path}`, { ...init, headers, credentials: "omit" });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const msg = (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string")
      ? (body as { error: string }).error : `Request failed (${res.status})`;
    throw new TrainingApiError(res.status, msg);
  }
  return body as T;
}

export const trainingLaunchApi = {
  status: () => launchRequest<TrainingStatus>("/status", {}, false),
  personas: () => launchRequest<{ seeded: boolean; personas: TrainingPersona[] }>("/personas"),
  reset: () => launchRequest<{ seeded: boolean }>("/reset", { method: "POST", body: JSON.stringify({ confirmation: "RESET TRAINING DATA" }) }),
  async startSession(persona: PersonaKey | string) {
    const r = await launchRequest<{ sessionToken: string; persona: TrainingPersona }>("/session", { method: "POST", body: JSON.stringify({ persona }) });
    saveTrainingSession(r.sessionToken, r.persona);
    window.location.assign(`${TRAINING_PORTAL_BASE}/dashboard`);
    return r;
  },
};

/** Requests made from inside the training portal (training bearer only). */
async function portalRequest<T>(path: string): Promise<T> {
  const token = getTrainingToken();
  if (!token) throw new TrainingApiError(401, "No training session");
  const res = await fetch(`${TRAINING_API_BASE}/api${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, credentials: "omit" });
  if (!res.ok) throw new TrainingApiError(res.status, `Request failed (${res.status})`);
  return res.json() as Promise<T>;
}
export type OutboxMessage = { id: number; recipient: string; subject: string; summary: string; giftCardIssueId: number | null; createdAt: string };
export type TrainingCard = { id: number; alias: string; status: string; cadValueCents: number };
export const trainingPortalApi = {
  outbox: () => portalRequest<{ messages: OutboxMessage[] }>("/training/outbox"),
  cards: () => portalRequest<{ cards: TrainingCard[] }>("/training/cards"),
};

/** Labels file names and CSV content when exporting from training. */
export function trainingExport(filename: string, csv: string): { filename: string; csv: string } {
  if (!IS_TRAINING) return { filename, csv };
  return { filename: `TRAINING-DUMMY-DATA-${filename}`, csv: `"TRAINING - DUMMY DATA - NOT REAL RECORDS"\n${csv}` };
}
