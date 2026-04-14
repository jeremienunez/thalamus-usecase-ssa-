-- Thalamus RSS Sources — SSA feed seed.
-- 3 tiers:
--   OSINT      — public catalogs, press, amateur observers, operator socials
--   ADVISORY   — official agencies, coordination bodies, conjunction advisories
--   SCIENCE    — peer-reviewed + open-science on orbital mechanics / debris
--
-- Run: psql -d research_agent -f packages/thalamus/src/cortices/storage/seed-rss-sources.sql

INSERT INTO rss_source (name, url, category, weight) VALUES

  -- ═══════════════════════════════════════════════════════════
  -- OSINT — Catalogs, press, communities
  -- ═══════════════════════════════════════════════════════════
  ('CelesTrak News', 'https://celestrak.org/news/rss.xml', 'OSINT', 2.5),
  ('Space-Track Notices (Google News)', 'https://news.google.com/rss/search?q=%22space-track%22+notice&hl=en&gl=US&ceid=US:en', 'OSINT', 2),
  ('SatTrackCam Leiden', 'https://sattrackcam.blogspot.com/feeds/posts/default?alt=rss', 'OSINT', 2),
  ('The Space Review', 'https://www.thespacereview.com/rss.xml', 'OSINT', 1.5),
  ('SpaceNews', 'https://spacenews.com/feed/', 'OSINT', 2),
  ('Ars Technica Space', 'https://arstechnica.com/science/space/feed/', 'OSINT', 1.5),
  ('Google News: Satellite Conjunction', 'https://news.google.com/rss/search?q=satellite+conjunction+close+approach&hl=en&gl=US&ceid=US:en', 'OSINT', 2),
  ('Google News: Orbital Debris', 'https://news.google.com/rss/search?q=orbital+debris+kessler&hl=en&gl=US&ceid=US:en', 'OSINT', 2),
  ('Google News: Launch Manifest', 'https://news.google.com/rss/search?q=launch+manifest+rideshare&hl=en&gl=US&ceid=US:en', 'OSINT', 1.5),
  ('Jonathan''s Space Report', 'https://www.planet4589.org/space/jsr/jsr.rss', 'OSINT', 2),

  -- ═══════════════════════════════════════════════════════════
  -- ADVISORY — Agencies, coordination bodies, conjunction advisories
  -- ═══════════════════════════════════════════════════════════
  ('NASA CNEOS News', 'https://cneos.jpl.nasa.gov/news/rss.xml', 'ADVISORY', 2.5),
  ('ESA Space Debris Office', 'https://www.esa.int/rssfeed/Safety_Security/Space_Debris', 'ADVISORY', 2.5),
  ('ESA Operations', 'https://www.esa.int/rssfeed/Enabling_Support/Operations', 'ADVISORY', 2),
  ('NOAA Office of Space Commerce', 'https://www.space.commerce.gov/feed/', 'ADVISORY', 2),
  ('UNOOSA News', 'https://www.unoosa.org/oosa/rss/news.xml', 'ADVISORY', 2),
  ('EU SST', 'https://www.eusst.eu/feed/', 'ADVISORY', 2),
  ('IADC News', 'https://www.iadc-home.org/feed', 'ADVISORY', 2),
  ('USSF 18 SDS Notices (Google News)', 'https://news.google.com/rss/search?q=%2218th+space+defense+squadron%22&hl=en&gl=US&ceid=US:en', 'ADVISORY', 2),

  -- ═══════════════════════════════════════════════════════════
  -- SCIENCE — Peer-reviewed + open-science (orbital mechanics, debris, SSA)
  -- ═══════════════════════════════════════════════════════════
  ('OpenAlex: Orbital Debris 2025', 'https://api.openalex.org/works?search=orbital%20debris%20conjunction&filter=publication_year:2025&sort=publication_date:desc&per_page=20', 'SCIENCE', 2.5),
  ('OpenAlex: Space Situational Awareness', 'https://api.openalex.org/works?search=space%20situational%20awareness&filter=publication_year:2025&sort=cited_by_count:desc&per_page=20', 'SCIENCE', 2.5),
  ('OpenAlex: SGP4 Propagation', 'https://api.openalex.org/works?search=SGP4%20orbit%20propagation&filter=publication_year:2025&sort=publication_date:desc&per_page=15', 'SCIENCE', 2),
  ('OpenAlex: Kessler Syndrome', 'https://api.openalex.org/works?search=kessler%20syndrome%20cascade&filter=publication_year:2025&sort=publication_date:desc&per_page=15', 'SCIENCE', 2),
  ('Acta Astronautica', 'https://www.sciencedirect.com/journal/acta-astronautica/rss', 'SCIENCE', 2),
  ('Advances in Space Research', 'https://www.sciencedirect.com/journal/advances-in-space-research/rss', 'SCIENCE', 2),
  ('Journal of Spacecraft and Rockets (AIAA)', 'https://arc.aiaa.org/action/showFeed?type=etoc&feed=rss&jc=jsr', 'SCIENCE', 2),
  ('arXiv astro-ph.EP', 'http://export.arxiv.org/rss/astro-ph.EP', 'SCIENCE', 1.5),
  ('arXiv astro-ph.IM', 'http://export.arxiv.org/rss/astro-ph.IM', 'SCIENCE', 1.5),

  -- ═══════════════════════════════════════════════════════════
  -- Internal discovery channel
  -- ═══════════════════════════════════════════════════════════
  ('Thalamus Explorer', 'internal://explorer', 'DISCOVERY', 2.0)

ON CONFLICT (url) DO NOTHING;
