import type { Config } from 'tailwindcss';
import { tokens } from './lib/design-tokens';

const config: Config = {
    darkMode: ['class'],
    content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
  	extend: {
  		fontFamily: {
  			// Design-refresh D2 · Gruppe 1: global `sans` er nå Segoe (Microsoft/Azure).
  			sans:      ['"Segoe UI"', '-apple-system', 'BlinkMacSystemFont', 'Roboto', 'sans-serif'],
  			segoe:     ['"Segoe UI"', '-apple-system', 'BlinkMacSystemFont', 'Roboto', 'sans-serif'],
  			// Barlow beholdt (lastet fra CDN) for display-headere som fortsatt bruker den.
  			barlow:    ['Barlow', 'system-ui', 'sans-serif'],
  			condensed: ['Barlow Condensed', 'system-ui', 'sans-serif'],
  		},
  		// Token-drevet skala (additiv — kolliderer ikke med eksisterende utilities).
  		fontSize: {
  			small:  [tokens.fontSize.small,  { lineHeight: String(tokens.lineHeight.normal) }],
  			body:   [tokens.fontSize.body,   { lineHeight: String(tokens.lineHeight.normal) }],
  			tabell: [tokens.fontSize.tabell, { lineHeight: String(tokens.lineHeight.tight) }],
  			h4:     [tokens.fontSize.h4,     { lineHeight: String(tokens.lineHeight.tight) }],
  			h3:     [tokens.fontSize.h3,     { lineHeight: String(tokens.lineHeight.tight) }],
  			h2:     [tokens.fontSize.h2,     { lineHeight: String(tokens.lineHeight.tight) }],
  			h1:     [tokens.fontSize.h1,     { lineHeight: String(tokens.lineHeight.tight) }],
  		},
  		colors: {
  			navy: {
  				DEFAULT: 'var(--navy)',
  				dark:    'var(--navy-dark)',
  				mid:     'var(--navy-mid)',
  			},
  			gold: {
  				DEFAULT: '#F5A623',
  				light:   '#F7BC55',
  			},
  			// Design-refresh D2 · Azure-semantiske farger (fra design-tokens/CSS-vars).
  			info:    'var(--color-info)',
  			success: 'var(--color-success)',
  			warning: 'var(--color-warning)',
  			danger:  'var(--color-danger)',
  			brand: {
  				'50': '#eff6ff',
  				'100': '#dbeafe',
  				'500': '#3b82f6',
  				'600': '#2563eb',
  				'700': '#1d4ed8',
  				'900': '#1e3a8a'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)',
  			// Design-refresh D2 · token-drevne Azure-radier (additiv).
  			small:  tokens.radii.small,
  			medium: tokens.radii.medium,
  			large:  tokens.radii.large,
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
