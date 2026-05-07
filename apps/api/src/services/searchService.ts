/**
 * Generisk wrapper rundt @azure/search-documents.
 *
 * Brukes av domene-spesifikke tjenester (slicerKatalogService osv.) til å
 * snakke med Azure AI Search. Holder seg agnostisk for hva som indekseres.
 *
 * Auth-konfig leses fra env: AZURE_SEARCH_ENDPOINT + AZURE_SEARCH_ADMIN_KEY.
 */

import {
  SearchIndexClient,
  SearchClient,
  AzureKeyCredential,
  type SearchIndex,
} from '@azure/search-documents';

export interface SearchQuery {
  searchText:    string;
  filter?:       string;
  top?:          number;
  select?:       string[];
  searchFields?: string[];
  searchMode?:   'any' | 'all';
}

export interface SearchTreff<T> {
  document: T;
  score:    number;
}

export interface SearchResult<T> {
  treff: SearchTreff<T>[];
}

export class SearchService {
  private indexClient:   SearchIndexClient;
  private endpoint:      string;
  private credential:    AzureKeyCredential;
  // SDK krever T extends object; vi bruker ukjent record som "any document".
  private searchClients = new Map<string, SearchClient<Record<string, unknown>>>();

  constructor(endpoint: string, adminKey: string) {
    this.endpoint   = endpoint;
    this.credential = new AzureKeyCredential(adminKey);
    this.indexClient = new SearchIndexClient(endpoint, this.credential);
  }

  // ── Indeks-administrasjon ────────────────────────────────────────────

  async opprettIndeks(definition: SearchIndex): Promise<void> {
    console.log(`[search] oppretter indeks "${definition.name}"`);
    try {
      await this.indexClient.createIndex(definition);
      console.log(`[search] indeks "${definition.name}" opprettet`);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 409) {
        console.log(`[search] indeks "${definition.name}" eksisterer allerede`);
        return;
      }
      throw err;
    }
  }

  async slettIndeks(name: string): Promise<void> {
    console.log(`[search] sletter indeks "${name}"`);
    try {
      await this.indexClient.deleteIndex(name);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) {
        console.log(`[search] indeks "${name}" finnes ikke (idempotent slett)`);
        return;
      }
      throw err;
    }
  }

  async finnesIndeks(name: string): Promise<boolean> {
    try {
      await this.indexClient.getIndex(name);
      return true;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) return false;
      throw err;
    }
  }

  // ── Dokument-administrasjon ──────────────────────────────────────────

  async indekserDokumenter(
    indexName: string,
    docs:      Record<string, unknown>[],
  ): Promise<void> {
    if (docs.length === 0) return;
    const klient = this.getSearchClient(indexName);
    console.log(`[search] indekserer ${docs.length} dokument(er) i "${indexName}"`);
    const resultat = await klient.uploadDocuments(docs);
    const feilet = resultat.results.filter((r) => !r.succeeded);
    if (feilet.length > 0) {
      const feilDetaljer = feilet.map((r) => `${r.key}: ${r.errorMessage ?? 'ukjent'}`).join('; ');
      throw new Error(`Indeksering feilet for ${feilet.length}/${docs.length}: ${feilDetaljer}`);
    }
  }

  /** Sletter dokumenter ut fra primary key field-navn og verdier. */
  async slettDokumenter(
    indexName: string,
    keyName:   string,
    keyValues: string[],
  ): Promise<void> {
    if (keyValues.length === 0) return;
    const klient = this.getSearchClient(indexName);
    console.log(`[search] sletter ${keyValues.length} dokument(er) fra "${indexName}"`);
    await klient.deleteDocuments(keyName, keyValues);
  }

  // ── Søk ──────────────────────────────────────────────────────────────

  async søk<T>(indexName: string, query: SearchQuery): Promise<SearchResult<T>> {
    const klient = this.getSearchClient(indexName);
    const respons = await klient.search(query.searchText, {
      filter:       query.filter,
      top:          query.top,
      // SDK forventer SearchFieldArray<T> men vi er agnostiske — cast til never[]
      select:       query.select as never,
      searchFields: query.searchFields as never,
      searchMode:   query.searchMode,
    });

    const treff: SearchTreff<T>[] = [];
    for await (const r of respons.results) {
      treff.push({ document: r.document as T, score: r.score ?? 0 });
    }
    return { treff };
  }

  // ── Internt ──────────────────────────────────────────────────────────

  private getSearchClient(indexName: string): SearchClient<Record<string, unknown>> {
    const eksisterende = this.searchClients.get(indexName);
    if (eksisterende) return eksisterende;

    const klient = new SearchClient<Record<string, unknown>>(
      this.endpoint, indexName, this.credential,
    );
    this.searchClients.set(indexName, klient);
    return klient;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

let instans: SearchService | null = null;

export function getSearchService(): SearchService {
  if (instans) return instans;
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const adminKey = process.env.AZURE_SEARCH_ADMIN_KEY;
  if (!endpoint || !adminKey) {
    throw new Error(
      'AZURE_SEARCH_ENDPOINT og AZURE_SEARCH_ADMIN_KEY må være satt i miljøet.',
    );
  }
  instans = new SearchService(endpoint, adminKey);
  return instans;
}
