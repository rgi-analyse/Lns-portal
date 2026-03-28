const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphTokenResponse {
  access_token: string;
}

export interface GraphGroup {
  id: string;
  displayName: string;
  description: string | null;
  mail: string | null;
}

export interface GraphUser {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
}

export interface GraphMember {
  id: string;
  displayName: string;
  mail: string | null;
}

interface GraphListResponse<T> {
  value: T[];
}

export async function getGraphToken(): Promise<string> {
  const tenantId     = process.env.PBI_TENANT_ID;
  const clientId     = process.env.PBI_CLIENT_ID;
  const clientSecret = process.env.PBI_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Mangler Azure AD-konfigurasjon på serveren.');
  }

  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Azure AD (Graph) feilet med HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as GraphTokenResponse;
  return data.access_token;
}

export async function searchGroups(query: string): Promise<GraphGroup[]> {
  const token = await getGraphToken();

  const params = new URLSearchParams();
  params.set('$search',  `"displayName:${query}"`);
  params.set('$select',  'id,displayName,description,mail');
  params.set('$top',     '10');

  const response = await fetch(`${GRAPH_BASE}/groups?${params.toString()}`, {
    headers: {
      Authorization:    `Bearer ${token}`,
      ConsistencyLevel: 'eventual',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph /groups feilet med HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as GraphListResponse<GraphGroup>;
  return Array.isArray(data.value) ? data.value : [];
}

export async function searchUsers(query: string): Promise<GraphUser[]> {
  const token = await getGraphToken();

  const params = new URLSearchParams();
  params.set('$search',  `"displayName:${query}" OR "mail:${query}"`);
  params.set('$select',  'id,displayName,mail,userPrincipalName');
  params.set('$top',     '10');

  const response = await fetch(`${GRAPH_BASE}/users?${params.toString()}`, {
    headers: {
      Authorization:    `Bearer ${token}`,
      ConsistencyLevel: 'eventual',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph /users feilet med HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as GraphListResponse<GraphUser>;
  return Array.isArray(data.value) ? data.value : [];
}

export async function getGroupMembers(groupId: string): Promise<GraphMember[]> {
  const token = await getGraphToken();

  const params = new URLSearchParams();
  params.set('$select', 'id,displayName,mail');

  const response = await fetch(
    `${GRAPH_BASE}/groups/${groupId}/members?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph /groups/${groupId}/members feilet med HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as GraphListResponse<GraphMember>;
  return data.value;
}
