--
-- PostgreSQL database dump
--

\restrict IgFLH8sDDS4WXsKaKNdbMIekq6Oq29AyYoG73ar3SZ5NGBxLxrAftwFFkQIQtTa

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: countries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.countries (id, code, name, name_en, name_fr, is_active, region, created_at, updated_at) FROM stdin;
ee082db6-3379-4212-8e55-d235c86c4529	FR	France	France	France	t	Europe	2026-02-12 17:02:34.436	2026-02-12 17:02:34.436
d671deb2-152b-4462-a0c7-14eb9db27094	DE	Allemagne	Germany	Allemagne	t	Europe	2026-02-12 17:02:34.439	2026-02-12 17:02:34.439
c44a3970-cc78-4bc1-abc1-57b68d5a97b3	BE	Belgique	Belgium	Belgique	t	Europe	2026-02-12 17:02:34.439	2026-02-12 17:02:34.439
e0b74e1a-4a93-4a91-8211-0426a9515ea1	ES	Espagne	Spain	Espagne	t	Europe	2026-02-12 17:02:34.44	2026-02-12 17:02:34.44
f302ef1a-1117-48bd-abd3-609292def41b	IT	Italie	Italy	Italie	t	Europe	2026-02-12 17:02:34.441	2026-02-12 17:02:34.441
95beb775-c47a-491d-a074-bfc5f934fe0d	UK	Royaume-Uni	United Kingdom	Royaume-Uni	t	Europe	2026-02-12 17:02:34.441	2026-02-12 17:02:34.441
09877858-d185-4134-8d44-11c5713c5217	US	États-Unis	United States	États-Unis	f	Americas	2026-02-12 17:02:34.442	2026-02-12 17:02:34.442
\.


--
-- PostgreSQL database dump complete
--

\unrestrict IgFLH8sDDS4WXsKaKNdbMIekq6Oq29AyYoG73ar3SZ5NGBxLxrAftwFFkQIQtTa

