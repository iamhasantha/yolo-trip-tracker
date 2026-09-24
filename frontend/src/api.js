const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  createTrip: (data) => request("/trips", { method: "POST", body: JSON.stringify(data) }),
  getTrip: (code) => request(`/trips/${code}`),

  listMembers: (code) => request(`/trips/${code}/members`),
  addMember: (code, name) => request(`/trips/${code}/members`, { method: "POST", body: JSON.stringify({ name }) }),
  removeMember: (code, id) => request(`/trips/${code}/members/${id}`, { method: "DELETE" }),

  listContributions: (code) => request(`/trips/${code}/contributions`),
  addContribution: (code, data) => request(`/trips/${code}/contributions`, { method: "POST", body: JSON.stringify(data) }),
  removeContribution: (code, id) => request(`/trips/${code}/contributions/${id}`, { method: "DELETE" }),

  listExpenses: (code) => request(`/trips/${code}/expenses`),
  addExpense: (code, data) => request(`/trips/${code}/expenses`, { method: "POST", body: JSON.stringify(data) }),
  removeExpense: (code, id) => request(`/trips/${code}/expenses/${id}`, { method: "DELETE" }),

  summary: (code) => request(`/trips/${code}/summary`),
  completion: (code) => request(`/trips/${code}/completion`),
  voteToComplete: (code, memberId, vote = true) => request(`/trips/${code}/completion/vote`, {
    method: "PUT",
    body: JSON.stringify({ memberId, vote }),
  }),
  reportUrl: (code) => `${BASE}/trips/${code}/report.pdf`,
};
