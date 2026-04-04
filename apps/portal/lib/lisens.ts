export interface Lisens {
  lisens:                 'basis' | 'standard' | 'premium';
  maxBrukere:             number;
  lisensUtløper:          string | null;
  chatAktivert:           boolean;
  designerAktivert:       boolean;
  kombinertChartAktivert: boolean;
  personalAiAktivert:     boolean;
  eksportAktivert:        boolean;
  erUtløpt:               boolean;
}

export const STANDARD_LISENS: Lisens = {
  lisens:                 'standard',
  maxBrukere:             50,
  lisensUtløper:          null,
  chatAktivert:           true,
  designerAktivert:       true,
  kombinertChartAktivert: true,
  personalAiAktivert:     false,
  eksportAktivert:        true,
  erUtløpt:               false,
};
