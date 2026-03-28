interface AzureTokenResponse {
  access_token: string;
}

export async function getAzureToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  scope = 'https://analysis.windows.net/powerbi/api/.default',
): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Azure AD feilet med HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as AzureTokenResponse;
  return data.access_token;
}
