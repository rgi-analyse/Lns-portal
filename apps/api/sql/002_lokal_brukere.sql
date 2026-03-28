-- Migrering: støtte for lokale brukere med passord-innlogging
-- Kjør én gang mot databasen

-- Legg til nye kolonner i Bruker-tabellen
ALTER TABLE [Bruker]
  ADD [erEntraBruker]     BIT           NOT NULL DEFAULT 1,
      [passordHash]       NVARCHAR(255) NULL,
      [måByttePassord]    BIT           NOT NULL DEFAULT 0,
      [sistPassordEndret] DATETIME2     NULL;

-- Alle eksisterende brukere er Entra-brukere
UPDATE [Bruker] SET [erEntraBruker] = 1;
