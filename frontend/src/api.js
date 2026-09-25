const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

function memberOptions(code, options = {}) {
  const token = localStorage.getItem(`yolo:${code}:token`);
  return {
    ...options,
    headers: { ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  };
}

export const api = {
  createTrip: (data) => request("/trips", { method: "POST", body: JSON.stringify(data) }),
  getTrip: (code) => request(`/trips/${code}`),
  me: (code) => request(`/trips/${code}/me`, memberOptions(code)),

  listMembers: (code) => request(`/trips/${code}/members`),
  addMember: (code, name) => request(`/trips/${code}/members`, { method: "POST", body: JSON.stringify({ name }) }),
  removeMember: (code, id) => request(`/trips/${code}/members/${id}`, memberOptions(code, { method: "DELETE" })),

  listContributions: (code) => request(`/trips/${code}/contributions`),
  addContribution: (code, data) => request(`/trips/${code}/contributions`, memberOptions(code, { method: "POST", body: JSON.stringify(data) })),
  removeContribution: (code, id) => request(`/trips/${code}/contributions/${id}`, memberOptions(code, { method: "DELETE" })),

  listExpenses: (code) => request(`/trips/${code}/expenses`),
  addExpense: (code, data) => request(`/trips/${code}/expenses`, memberOptions(code, { method: "POST", body: JSON.stringify(data) })),
  removeExpense: (code, id) => request(`/trips/${code}/expenses/${id}`, memberOptions(code, { method: "DELETE" })),

  listNotes: (code) => request(`/trips/${code}/notes`),
  addNote: (code, data) => request(`/trips/${code}/notes`, memberOptions(code, { method: "POST", body: JSON.stringify(data) })),
  removeNote: (code, id) => request(`/trips/${code}/notes/${id}`, memberOptions(code, { method: "DELETE" })),

  summary: (code) => request(`/trips/${code}/summary`),
  completion: (code) => request(`/trips/${code}/completion`),
  voteToComplete: (code, memberId, vote = true) => request(`/trips/${code}/completion/vote`, memberOptions(code, {
    method: "PUT",
    body: JSON.stringify({ memberId, vote }),
  })),
  reportUrl: (code) => `${BASE}/trips/${code}/report.pdf`,
};
