-- Migration 005: OrganisasjonTema-tabell for tema/CSS-variabler per organisasjon
-- Kjør én gang mot Azure SQL (tilsvarer: npx prisma migrate dev --name legg-til-organisasjon-tema)

CREATE TABLE OrganisasjonTema (
  id               NVARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT NEWID(),
  organisasjonNavn NVARCHAR(200) NOT NULL UNIQUE,
  primaryColor     NVARCHAR(20)  NOT NULL DEFAULT '#F5A623',
  backgroundColor  NVARCHAR(20)  NOT NULL DEFAULT '#0a1628',
  navyColor        NVARCHAR(20)  NOT NULL DEFAULT '#1B2A4A',
  accentColor      NVARCHAR(20)  NOT NULL DEFAULT '#243556',
  logoUrl          NVARCHAR(500) NULL,
  oppdatert        DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  opprettet        DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);
