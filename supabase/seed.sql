SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict NJf5fR35kvrfCUTYodj096ZqSfpuG0vINbGh0jceZOwuBP6QUHk2eI13rlaIOsJ

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

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
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") VALUES
	('00000000-0000-0000-0000-000000000000', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'authenticated', 'authenticated', 'konglnwzas@gmail.com', '$2a$10$wppakW41xkfc/19x6z1dJ.88ZL2HlzYmXz06htIDnI.wkvPz8ijvm', '2026-01-20 05:03:35.187253+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-01-24 14:51:32.589791+00', '{"provider": "email", "providers": ["email"]}', '{"email_verified": true}', NULL, '2026-01-20 05:03:35.166913+00', '2026-01-24 14:51:32.594172+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', 'authenticated', 'authenticated', 'kongphop.sunit@gmail.com', '$2a$10$X5dT9zoGF7y7kewyPQVIzO.z5u8NLc/DJEVT06N5yQF5V8DdJJdrO', '2026-01-23 16:13:19.227426+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-01-23 16:17:10.258641+00', '{"provider": "email", "providers": ["email"]}', '{"email_verified": true}', NULL, '2026-01-23 16:13:19.195405+00', '2026-01-24 16:18:22.105759+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false);


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") VALUES
	('b5bc17ad-e050-4f74-9205-5147ec350d83', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '{"sub": "b5bc17ad-e050-4f74-9205-5147ec350d83", "email": "konglnwzas@gmail.com", "email_verified": false, "phone_verified": false}', 'email', '2026-01-20 05:03:35.1816+00', '2026-01-20 05:03:35.181667+00', '2026-01-20 05:03:35.181667+00', '180e51e9-a1f8-41b3-8a2d-44662ec80a66'),
	('ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', '{"sub": "ffddfce5-26a4-4e57-8f3e-86ace5ef45fe", "email": "kongphop.sunit@gmail.com", "email_verified": false, "phone_verified": false}', 'email', '2026-01-23 16:13:19.221776+00', '2026-01-23 16:13:19.221852+00', '2026-01-23 16:13:19.221852+00', '0f6612b9-a254-4b13-aca4-f4ad6fcd82c5');


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."sessions" ("id", "user_id", "created_at", "updated_at", "factor_id", "aal", "not_after", "refreshed_at", "user_agent", "ip", "tag", "oauth_client_id", "refresh_token_hmac_key", "refresh_token_counter", "scopes") VALUES
	('df7c8388-bfba-4900-ba55-7a385ac4b70b', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:17:42.096834+00', '2026-01-24 14:17:42.096834+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('b68208f2-19b7-450f-9a3b-a7a5b5f56663', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:17:49.817687+00', '2026-01-24 14:17:49.817687+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('343535f8-f77d-4cb7-8ba3-ea0d1e1552a1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:17:59.054288+00', '2026-01-24 14:17:59.054288+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('317367e7-7343-4ac0-8930-e347d964c97a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:18:04.336058+00', '2026-01-24 14:18:04.336058+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('fbe77f7d-8f79-4e0b-91ed-88cb62ae4809', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:18:12.953182+00', '2026-01-24 14:18:12.953182+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('93693377-adf4-42a0-85cf-a9cab48c3379', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:18:23.544984+00', '2026-01-24 14:18:23.544984+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('b901b577-0365-4410-9ee3-1e57e1a9f229', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:18:28.444716+00', '2026-01-24 14:18:28.444716+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('fddae97d-e42b-4be1-9fe0-23be90c78da7', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:18:35.808075+00', '2026-01-24 14:18:35.808075+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('0201b3b5-b21a-4fe5-8404-2dedd1209e6e', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:18:44.683179+00', '2026-01-24 14:18:44.683179+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('3507fbd0-409a-4cc1-963a-ef412c0caccd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:23:02.146714+00', '2026-01-24 14:23:02.146714+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('adede784-da43-46ec-b52a-b664a5220815', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:23:09.748983+00', '2026-01-24 14:23:09.748983+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('1217dbe2-95c8-40d7-81f6-f248b05f5790', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:23:14.838211+00', '2026-01-24 14:23:14.838211+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('df2d3e26-4501-4886-8272-df906de6898e', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:31:34.768111+00', '2026-01-24 14:31:34.768111+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('47e1893b-39bf-4581-898d-5c206ce23aa6', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:23:25.696272+00', '2026-01-24 14:23:25.696272+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('78e129a3-4c4b-43fd-92d2-670c7ed5fa9a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:23:34.847703+00', '2026-01-24 14:23:34.847703+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('a06d6456-174a-4b44-8188-3a0a6c924064', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:23:38.109829+00', '2026-01-24 14:23:38.109829+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('a77602d0-fc50-428a-a194-1e4be5e46eaa', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:23:48.067853+00', '2026-01-24 14:23:48.067853+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('34627561-6bef-4b60-9ffe-79485c8d9e5a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:23:55.592527+00', '2026-01-24 14:23:55.592527+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('b4898214-c2d2-4ca5-9310-a5467d4f1c4a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:23:58.531825+00', '2026-01-24 14:23:58.531825+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('81798fc4-576b-4fc0-89b2-68317faba5e3', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:28:13.301025+00', '2026-01-24 14:28:13.301025+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('0b873f27-9b8c-4087-ba8e-56b1344f4e4d', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:28:20.726344+00', '2026-01-24 14:28:20.726344+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('90861416-7a58-42eb-aada-571dfa9c3fe0', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:28:25.755353+00', '2026-01-24 14:28:25.755353+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('cadb863e-b009-4062-b412-9e776f1c3f45', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:28:31.688444+00', '2026-01-24 14:28:31.688444+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('4652f440-0bca-41bb-bbb0-6ff2d1d0b2d7', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:28:41.267369+00', '2026-01-24 14:28:41.267369+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('aae80b8f-1b68-4f91-a71d-889588c2e375', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:28:44.636957+00', '2026-01-24 14:28:44.636957+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('ae920302-c321-452e-b340-517f013cdc52', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:28:50.365449+00', '2026-01-24 14:28:50.365449+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('a7cbb3fc-3009-4889-aaf4-dcfafa1c5cc3', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:28:59.107404+00', '2026-01-24 14:28:59.107404+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('c7df5b80-d9c0-46a8-984f-f944b2eb2173', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:29:02.647462+00', '2026-01-24 14:29:02.647462+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('66ecde68-59f4-44d5-9070-17ef84a4adc0', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:30:41.927435+00', '2026-01-24 14:30:41.927435+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('6f4e0784-11e5-4d07-a6f2-c31bb6bef839', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:31:27.998163+00', '2026-01-24 14:31:27.998163+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('e31c6b67-6ed5-4811-8b19-d832192aa007', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:31:37.436943+00', '2026-01-24 14:31:37.436943+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('ca41846f-aacd-485c-a936-3f1bbefc359b', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:31:42.20607+00', '2026-01-24 14:31:42.20607+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('2a1abe4b-7e85-4720-8401-31dc8b0a34f0', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:31:51.803441+00', '2026-01-24 14:31:51.803441+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('7961b6ef-1d36-4caa-a9f0-e71b1aa09a7b', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:31:54.914758+00', '2026-01-24 14:31:54.914758+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('bccf5a7b-6744-4248-85f5-2220f1d633e0', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:31:59.463796+00', '2026-01-24 14:31:59.463796+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('1717456a-d679-4b04-ab1b-7eb2a014f54c', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:32:06.809456+00', '2026-01-24 14:32:06.809456+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('c108eba1-4a4b-425e-b739-ac9358b10a68', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:32:09.711611+00', '2026-01-24 14:32:09.711611+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('258de09f-deb7-4e99-ac6b-9b2b4f672074', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:34:54.806778+00', '2026-01-24 14:34:54.806778+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('6e9716e3-1e6e-4148-996b-d25a59c9ca4a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:35:07.728268+00', '2026-01-24 14:35:07.728268+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('8a893489-b7c0-4840-8139-679db0a90ddd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:35:10.433967+00', '2026-01-24 14:35:10.433967+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('6763001c-ef4d-4c59-b015-cdb53b3ab2ea', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:35:17.031294+00', '2026-01-24 14:35:17.031294+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('65021528-7116-4cfb-bec9-d3bd54e1ba30', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:35:31.205923+00', '2026-01-24 14:35:31.205923+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('86aaf621-f223-40f8-8424-c8c07a67b9fe', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:35:34.374527+00', '2026-01-24 14:35:34.374527+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('2dbde60e-9896-4c36-a1b9-6dc8f7905a43', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:35:39.388748+00', '2026-01-24 14:35:39.388748+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('281ee31c-9d10-4405-9409-fb047ad82912', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:35:52.326079+00', '2026-01-24 14:35:52.326079+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('538d36ba-de94-4aed-a0e5-628b39272e0d', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:35:55.298272+00', '2026-01-24 14:35:55.298272+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('b824462f-753e-4750-9272-c2012ef1ae71', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:38:01.333531+00', '2026-01-24 14:38:01.333531+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('41bdaae5-62bb-4e97-a3b4-0d92cb976e83', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:38:02.850867+00', '2026-01-24 14:38:02.850867+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('daf1443e-65b7-485c-93d3-8568e1344ecd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:38:05.892661+00', '2026-01-24 14:38:05.892661+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('43483934-7eaa-45a7-8d51-4587e2625bfe', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:38:10.839641+00', '2026-01-24 14:38:10.839641+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('64a40430-db31-49e4-8c95-36a3117b41e2', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:38:12.493448+00', '2026-01-24 14:38:12.493448+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('df2f1a03-4f4a-44fe-b1b8-4c3d562a9ff1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:38:15.566024+00', '2026-01-24 14:38:15.566024+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('229942f0-90b1-459c-bb08-a5aaf18f93e5', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:38:22.581811+00', '2026-01-24 14:38:22.581811+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('e5106c5d-d35a-41cb-a780-320d01b53d63', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:38:24.165909+00', '2026-01-24 14:38:24.165909+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('c8c6c525-bfa4-4e07-9622-af27a7233f01', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:38:27.109483+00', '2026-01-24 14:38:27.109483+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('2ec36887-d1db-49b5-9e4c-c01eb9fe823d', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:41:01.716526+00', '2026-01-24 14:41:01.716526+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('f7fa63d9-a728-48c5-a2ca-be5c53335ee4', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:41:02.770684+00', '2026-01-24 14:41:02.770684+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('0c39209d-98c7-4930-8513-1eab34f91c9a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:41:05.40254+00', '2026-01-24 14:41:05.40254+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('d23d9aa5-4605-4392-b323-1cc6aa335d82', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:41:10.66776+00', '2026-01-24 14:41:10.66776+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('99d3dba8-f4b5-4ef7-b156-c20fc4384027', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:41:12.338443+00', '2026-01-24 14:41:12.338443+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('e1c66b32-871a-43f8-b35b-07cf97446e56', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:41:16.017051+00', '2026-01-24 14:41:16.017051+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('661d5c0e-84cf-4d0b-a306-dab2eff0c541', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:41:21.240211+00', '2026-01-24 14:41:21.240211+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('42e09b4e-6f48-4024-9778-9aef1566615a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:41:22.942403+00', '2026-01-24 14:41:22.942403+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('78f7d363-ce1b-4665-9c4e-5db6b80f94cd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:41:26.56645+00', '2026-01-24 14:41:26.56645+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('e348f455-d750-4ec4-9abd-5a4af9f470a2', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:43:51.142763+00', '2026-01-24 14:43:51.142763+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('3f6749b4-26d5-4415-ae99-778ae2783611', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:43:52.448337+00', '2026-01-24 14:43:52.448337+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('7c1cdca1-5b1c-4cdd-8263-392decd83645', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:43:55.210558+00', '2026-01-24 14:43:55.210558+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('655f593c-da40-44f9-9ea5-9bdc94518db8', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:02.065658+00', '2026-01-24 14:44:02.065658+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('0695a29e-a5a2-47be-8fce-752c73e125a9', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:04.404228+00', '2026-01-24 14:44:04.404228+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('28aa3c04-0f91-4238-8ade-ffd4b54498b3', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:08.156127+00', '2026-01-24 14:44:08.156127+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('a57f2df0-f6f0-44bd-a7ba-c1565a6f7e1f', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:13.86594+00', '2026-01-24 14:44:13.86594+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('98286ca3-7323-4bf9-9f4c-5a1979d19743', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:16.381874+00', '2026-01-24 14:44:16.381874+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('31b4b478-a712-48a4-9ea3-c13672fa5423', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:19.377695+00', '2026-01-24 14:44:19.377695+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('9f9e88c7-ffc7-4b59-93a1-550267e60e09', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:23.282246+00', '2026-01-24 14:44:23.282246+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36 Edg/143.0.7499.4', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('886bf48e-c381-47a8-bed8-21294966a6ab', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:24.285316+00', '2026-01-24 14:44:24.285316+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36 Edg/143.0.7499.4', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('0e3cf68f-a973-449d-aa56-7f536493e101', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:26.957811+00', '2026-01-24 14:44:26.957811+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36 Edg/143.0.7499.4', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('695cea6b-5b4f-44dd-8cfa-e69cb543312a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:31.352634+00', '2026-01-24 14:44:31.352634+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('df7e9389-53a9-4226-b402-7435ee02f2e8', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:33.955725+00', '2026-01-24 14:44:33.955725+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('3a82ec2e-ceda-44cc-9f17-db7f85bc3eb3', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:37.16254+00', '2026-01-24 14:44:37.16254+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('54b1d3ff-b570-4d41-9b78-1d05438bd4fb', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:41.4827+00', '2026-01-24 14:44:41.4827+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('ae75cd05-bc89-40fb-84a5-1c5a8f8112dc', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:42.63255+00', '2026-01-24 14:44:42.63255+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('f33d8d74-c768-4238-9fba-c74040aa0d85', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:45.343697+00', '2026-01-24 14:44:45.343697+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('e5154485-8bd8-4fb0-9f7a-c4a60a97377a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:48.524535+00', '2026-01-24 14:44:48.524535+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('1b06e909-979b-40eb-b8e1-08c6fa4222b6', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:49.742861+00', '2026-01-24 14:44:49.742861+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('16d644fb-016e-4cfa-be1a-490856e74c66', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:52.534414+00', '2026-01-24 14:44:52.534414+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('a6b41c89-56f4-4dd7-9287-7b999935f0ac', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:55.890817+00', '2026-01-24 14:44:55.890817+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('08f12703-4fe7-4781-9b86-67d21b1a999f', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:44:56.952855+00', '2026-01-24 14:44:56.952855+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('94a19185-296b-4585-8c5b-95124ed880f7', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:45:00.277166+00', '2026-01-24 14:45:00.277166+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('ea5e6a31-5df7-401f-b567-202adf5811c9', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:45:04.099847+00', '2026-01-24 14:45:04.099847+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('2f97c556-5d94-4754-9d73-42aa8291a9e1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:45:05.408407+00', '2026-01-24 14:45:05.408407+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('ae23cc63-431e-4b64-9eec-711de07eb140', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:45:08.109005+00', '2026-01-24 14:45:08.109005+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('aa607d65-529b-4861-8fb8-012ee6ea57c1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:45:11.311575+00', '2026-01-24 14:45:11.311575+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('74204515-e9ea-4113-bca4-40fc359259b5', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:45:12.361338+00', '2026-01-24 14:45:12.361338+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('4aa9785f-8915-4c3a-bc89-247e270e3bee', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:45:15.04279+00', '2026-01-24 14:45:15.04279+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('ae940bde-0a11-4dd9-a42b-e7c73a1533d3', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:27.053632+00', '2026-01-24 14:49:27.053632+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('f269d1cf-638c-4a3b-9c46-287eb7bde1d1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:29.053944+00', '2026-01-24 14:49:29.053944+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('ec7a5341-eba8-4d4d-be7e-a485878aacbe', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:31.694372+00', '2026-01-24 14:49:31.694372+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('380853ad-5d22-49e5-ab1d-2cbc7786f498', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:37.144997+00', '2026-01-24 14:49:37.144997+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('bf1bf82b-c32d-45b0-808e-514739d7ed18', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:39.228896+00', '2026-01-24 14:49:39.228896+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('f7ef9d1e-f5e6-4a06-9b1c-b59265cf3b83', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:42.548108+00', '2026-01-24 14:49:42.548108+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0.2) Gecko/20100101 Firefox/144.0.2', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('3f6c160f-cad3-4fb6-a5f7-a81eb27d70a0', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:48.410278+00', '2026-01-24 14:49:48.410278+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('72e4ee3c-b972-423e-9572-6641e259cc39', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:50.892479+00', '2026-01-24 14:49:50.892479+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('342417e7-39b9-4e8b-ae5e-74ea52edae68', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:53.755705+00', '2026-01-24 14:49:53.755705+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('888161ef-00c3-49b7-ba88-6c88e0800638', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:57.298568+00', '2026-01-24 14:49:57.298568+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36 Edg/143.0.7499.4', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('4e4461ba-edfb-4475-9c70-0aedfbf25a2e', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:49:58.25849+00', '2026-01-24 14:49:58.25849+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36 Edg/143.0.7499.4', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('55f4ad1f-f89d-4df3-844b-7ad5748de91d', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:00.951496+00', '2026-01-24 14:50:00.951496+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Safari/537.36 Edg/143.0.7499.4', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('f9ecbf35-9571-49d3-84dc-f0945c730aaa', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:04.841568+00', '2026-01-24 14:50:04.841568+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('a0191e58-e9ce-412d-86b4-b43fbe2ac118', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:06.420058+00', '2026-01-24 14:50:06.420058+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('84e44e72-e59c-4051-b373-430407bdbf46', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:09.778116+00', '2026-01-24 14:50:09.778116+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('9b940eda-207d-48c5-a55d-2dd59062246e', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:12.708945+00', '2026-01-24 14:50:12.708945+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('99b2a645-014d-41d3-a79e-1be44d4b12a6', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:13.773788+00', '2026-01-24 14:50:13.773788+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('e3cffa69-7b74-4d8e-ba88-499a0a4578f1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:16.444314+00', '2026-01-24 14:50:16.444314+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('a5d659d3-1db6-4cb6-887d-1521740ec322', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:19.641174+00', '2026-01-24 14:50:19.641174+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('27bcc9d3-eaf3-4dcf-8d3b-d60b7714a5cc', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:20.929238+00', '2026-01-24 14:50:20.929238+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('0c9e7fdf-c98e-4097-af08-e38aeaf2d8eb', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:23.532852+00', '2026-01-24 14:50:23.532852+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('bb617bfd-28c4-45c4-a165-d33f272c30ba', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:26.528959+00', '2026-01-24 14:50:26.528959+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('0b6ac386-f620-40f7-ba17-60c9c25407ce', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:27.550141+00', '2026-01-24 14:50:27.550141+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('8e41d94d-cc30-48a2-9b5e-2938b43a91e5', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:30.182885+00', '2026-01-24 14:50:30.182885+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('da11c6a3-d965-4a0f-be61-191f4be6c45e', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:33.468841+00', '2026-01-24 14:50:33.468841+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('066407a8-b555-451d-b00d-a0776483dd41', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:34.47498+00', '2026-01-24 14:50:34.47498+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('0164c032-7b7b-44f2-8745-f22db1263839', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:37.193458+00', '2026-01-24 14:50:37.193458+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('fcfa4d09-2129-4696-8855-b7415aee98fd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:40.079935+00', '2026-01-24 14:50:40.079935+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('304aa9c3-dcf1-4a1f-b349-b570b4a9f12f', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:41.121996+00', '2026-01-24 14:50:41.121996+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('9ac51b93-ed9a-4e8c-924d-2c92ccf95013', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:43.741895+00', '2026-01-24 14:50:43.741895+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('6ac7f656-30fd-47d1-a8dc-37d4a8f2ccb4', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:46.73668+00', '2026-01-24 14:50:46.73668+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Mobile Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('5522a07a-a377-433d-b677-6bac7ef6ac1d', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:48.264032+00', '2026-01-24 14:50:48.264032+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Mobile Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('c8853a2e-a7e7-43b3-a3f1-5781dcb1db73', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:51.107017+00', '2026-01-24 14:50:51.107017+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.4 Mobile Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('8dc415b4-a7a4-4422-ad19-0b7d8d1faeee', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:53.98968+00', '2026-01-24 14:50:53.98968+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('a84b6a9b-e93e-4199-8b2f-c4225972bf2a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:55.52125+00', '2026-01-24 14:50:55.52125+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('fdc6f028-3f22-48d9-b24a-0b09be8bf8ae', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:50:58.582915+00', '2026-01-24 14:50:58.582915+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('5a3849b7-a6b8-4404-836d-1bfd5816eeb1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:02.356314+00', '2026-01-24 14:51:02.356314+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('604ce3ed-a4dd-44a9-916f-ca2f9ca613ef', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:03.837001+00', '2026-01-24 14:51:03.837001+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('39b54740-fbf6-4781-876b-7f0f8f34b177', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:06.78721+00', '2026-01-24 14:51:06.78721+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('510f09da-e0b9-45ff-a72b-cc791c113e27', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:11.033052+00', '2026-01-24 14:51:11.033052+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('3ba0576b-c505-42b7-adef-5cde0cee1f99', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:12.496486+00', '2026-01-24 14:51:12.496486+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('92b7aaff-02a4-4323-8517-f0049b387c34', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:16.02927+00', '2026-01-24 14:51:16.02927+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('27e7bfed-4d32-4bb6-93f7-1cb2ab4a0bf1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:19.319633+00', '2026-01-24 14:51:19.319633+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('e46eb736-0c08-444d-8a5e-42f842dc32ec', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:20.816008+00', '2026-01-24 14:51:20.816008+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('e340da03-6740-411d-8f34-23daa204d4b0', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:23.691037+00', '2026-01-24 14:51:23.691037+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('1d41ff06-386f-42e9-8d49-9ad36180bb5b', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:27.109935+00', '2026-01-24 14:51:27.109935+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('3257fe8a-2d08-4786-a19c-b353733aa062', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:28.647664+00', '2026-01-24 14:51:28.647664+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('33a6a7a9-4bae-48e9-96e0-7bbd4ba7b3c7', 'b5bc17ad-e050-4f74-9205-5147ec350d83', '2026-01-24 14:51:32.589887+00', '2026-01-24 14:51:32.589887+00', NULL, 'aal1', NULL, NULL, 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', '184.22.100.30', NULL, NULL, NULL, NULL, NULL),
	('762472e7-a8f4-4bb7-b3a0-edc960ac9440', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', '2026-01-23 16:17:10.261837+00', '2026-01-24 16:18:22.120793+00', NULL, 'aal1', NULL, '2026-01-24 16:18:22.120679', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36', '184.22.100.30', NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."mfa_amr_claims" ("session_id", "created_at", "updated_at", "authentication_method", "id") VALUES
	('762472e7-a8f4-4bb7-b3a0-edc960ac9440', '2026-01-23 16:17:10.282666+00', '2026-01-23 16:17:10.282666+00', 'password', '6054c704-2acf-4153-b0dc-7c473599a96f'),
	('df7c8388-bfba-4900-ba55-7a385ac4b70b', '2026-01-24 14:17:42.172186+00', '2026-01-24 14:17:42.172186+00', 'password', '2a921cab-d084-4a75-807e-550f0910f782'),
	('b68208f2-19b7-450f-9a3b-a7a5b5f56663', '2026-01-24 14:17:49.820671+00', '2026-01-24 14:17:49.820671+00', 'password', 'e1e4ff52-6e0d-4aa4-9efd-d5ec97004466'),
	('343535f8-f77d-4cb7-8ba3-ea0d1e1552a1', '2026-01-24 14:17:59.056659+00', '2026-01-24 14:17:59.056659+00', 'password', '012679c9-4268-4c42-93c7-990e923d1acc'),
	('317367e7-7343-4ac0-8930-e347d964c97a', '2026-01-24 14:18:04.338522+00', '2026-01-24 14:18:04.338522+00', 'password', '2fe3b514-1c40-4150-a8fd-83818b952f54'),
	('fbe77f7d-8f79-4e0b-91ed-88cb62ae4809', '2026-01-24 14:18:12.956428+00', '2026-01-24 14:18:12.956428+00', 'password', 'ed8130a0-5f89-4a61-b7c2-8c724acdb14a'),
	('93693377-adf4-42a0-85cf-a9cab48c3379', '2026-01-24 14:18:23.547341+00', '2026-01-24 14:18:23.547341+00', 'password', 'd05e223e-ffa1-4edf-95f5-b21247bab971'),
	('b901b577-0365-4410-9ee3-1e57e1a9f229', '2026-01-24 14:18:28.446638+00', '2026-01-24 14:18:28.446638+00', 'password', 'd9ff15f3-00ca-4b55-a137-dd5e06bd9db9'),
	('fddae97d-e42b-4be1-9fe0-23be90c78da7', '2026-01-24 14:18:35.810415+00', '2026-01-24 14:18:35.810415+00', 'password', '08d1e44e-a7f4-472a-8261-be57c590dfbb'),
	('0201b3b5-b21a-4fe5-8404-2dedd1209e6e', '2026-01-24 14:18:44.685556+00', '2026-01-24 14:18:44.685556+00', 'password', '6550c607-0df9-4388-90e1-38c008a3a6d9'),
	('3507fbd0-409a-4cc1-963a-ef412c0caccd', '2026-01-24 14:23:02.199813+00', '2026-01-24 14:23:02.199813+00', 'password', 'a370db9a-69e4-452a-9764-6874a38407dc'),
	('adede784-da43-46ec-b52a-b664a5220815', '2026-01-24 14:23:09.78762+00', '2026-01-24 14:23:09.78762+00', 'password', '4d9a3ef8-8580-466b-843f-cc1bcd8263d9'),
	('1217dbe2-95c8-40d7-81f6-f248b05f5790', '2026-01-24 14:23:14.844746+00', '2026-01-24 14:23:14.844746+00', 'password', '7c20297d-7a8b-477a-87fe-8cdce4dcf41c'),
	('47e1893b-39bf-4581-898d-5c206ce23aa6', '2026-01-24 14:23:25.698745+00', '2026-01-24 14:23:25.698745+00', 'password', 'e4e2affb-171e-4e12-89cc-a04f6183e62b'),
	('78e129a3-4c4b-43fd-92d2-670c7ed5fa9a', '2026-01-24 14:23:34.851107+00', '2026-01-24 14:23:34.851107+00', 'password', '2cf5c103-c5e6-4528-96a7-bcbe7397f07e'),
	('a06d6456-174a-4b44-8188-3a0a6c924064', '2026-01-24 14:23:38.115024+00', '2026-01-24 14:23:38.115024+00', 'password', 'ffc95a82-3337-41c3-b5f5-3fd691674c5a'),
	('a77602d0-fc50-428a-a194-1e4be5e46eaa', '2026-01-24 14:23:48.07096+00', '2026-01-24 14:23:48.07096+00', 'password', 'a0e0181d-4f61-4e04-9694-ee263d5b1967'),
	('34627561-6bef-4b60-9ffe-79485c8d9e5a', '2026-01-24 14:23:55.594822+00', '2026-01-24 14:23:55.594822+00', 'password', 'aeb34b53-26bd-4fdb-a480-a3e760eb5fab'),
	('b4898214-c2d2-4ca5-9310-a5467d4f1c4a', '2026-01-24 14:23:58.534567+00', '2026-01-24 14:23:58.534567+00', 'password', 'a4648246-2dfc-4a5a-acb2-d06bbf44d61c'),
	('81798fc4-576b-4fc0-89b2-68317faba5e3', '2026-01-24 14:28:13.311557+00', '2026-01-24 14:28:13.311557+00', 'password', '19c849e2-6dd5-4fa3-9835-33b64f526750'),
	('0b873f27-9b8c-4087-ba8e-56b1344f4e4d', '2026-01-24 14:28:20.729617+00', '2026-01-24 14:28:20.729617+00', 'password', '1ffe1fb1-7ba6-4d75-a47e-23420568d7e5'),
	('90861416-7a58-42eb-aada-571dfa9c3fe0', '2026-01-24 14:28:25.757605+00', '2026-01-24 14:28:25.757605+00', 'password', '9f7ac5e0-4c4f-4853-88d4-5d0acb256177'),
	('cadb863e-b009-4062-b412-9e776f1c3f45', '2026-01-24 14:28:31.691093+00', '2026-01-24 14:28:31.691093+00', 'password', 'd971e7f9-cd16-4b76-9f3c-956dc4fd4643'),
	('4652f440-0bca-41bb-bbb0-6ff2d1d0b2d7', '2026-01-24 14:28:41.269798+00', '2026-01-24 14:28:41.269798+00', 'password', '03e2045b-733c-40e3-b170-33e46d4912e6'),
	('aae80b8f-1b68-4f91-a71d-889588c2e375', '2026-01-24 14:28:44.639256+00', '2026-01-24 14:28:44.639256+00', 'password', 'cab9009a-34b0-47f1-a5d0-7b97eaa81165'),
	('ae920302-c321-452e-b340-517f013cdc52', '2026-01-24 14:28:50.367725+00', '2026-01-24 14:28:50.367725+00', 'password', '75366b1f-4857-4f23-9c9c-662933bee7af'),
	('a7cbb3fc-3009-4889-aaf4-dcfafa1c5cc3', '2026-01-24 14:28:59.109845+00', '2026-01-24 14:28:59.109845+00', 'password', '9804587b-8189-449b-a3ef-9f6c74498db4'),
	('c7df5b80-d9c0-46a8-984f-f944b2eb2173', '2026-01-24 14:29:02.651375+00', '2026-01-24 14:29:02.651375+00', 'password', '18abb6f7-2b4e-4e28-8f6c-7f221e03ef5e'),
	('66ecde68-59f4-44d5-9070-17ef84a4adc0', '2026-01-24 14:30:41.93193+00', '2026-01-24 14:30:41.93193+00', 'password', 'c2c79899-7641-4b50-a8b2-8a7bf676b4d6'),
	('6f4e0784-11e5-4d07-a6f2-c31bb6bef839', '2026-01-24 14:31:28.000628+00', '2026-01-24 14:31:28.000628+00', 'password', '3d7d1702-3e16-40bb-a27d-531fec17627f'),
	('df2d3e26-4501-4886-8272-df906de6898e', '2026-01-24 14:31:34.770518+00', '2026-01-24 14:31:34.770518+00', 'password', '2ecc9f26-8915-483f-85df-ffd9bb7cad84'),
	('e31c6b67-6ed5-4811-8b19-d832192aa007', '2026-01-24 14:31:37.439266+00', '2026-01-24 14:31:37.439266+00', 'password', 'd82876db-c30a-42fe-95af-29dafecd31a6'),
	('ca41846f-aacd-485c-a936-3f1bbefc359b', '2026-01-24 14:31:42.208479+00', '2026-01-24 14:31:42.208479+00', 'password', '37ef10b9-3280-442b-bdcf-c6cf79b4f6dd'),
	('2a1abe4b-7e85-4720-8401-31dc8b0a34f0', '2026-01-24 14:31:51.805902+00', '2026-01-24 14:31:51.805902+00', 'password', '1e6fcee1-f3d7-4064-ba19-c91bab7b2df2'),
	('7961b6ef-1d36-4caa-a9f0-e71b1aa09a7b', '2026-01-24 14:31:54.917527+00', '2026-01-24 14:31:54.917527+00', 'password', '911eb6c4-c987-4ac6-97e6-814536fbc1f6'),
	('bccf5a7b-6744-4248-85f5-2220f1d633e0', '2026-01-24 14:31:59.465988+00', '2026-01-24 14:31:59.465988+00', 'password', '9f0a9073-54d5-4de0-b63e-200c4db8c321'),
	('1717456a-d679-4b04-ab1b-7eb2a014f54c', '2026-01-24 14:32:06.811543+00', '2026-01-24 14:32:06.811543+00', 'password', 'c629946a-dd96-4380-8664-474b7c2ca632'),
	('c108eba1-4a4b-425e-b739-ac9358b10a68', '2026-01-24 14:32:09.713717+00', '2026-01-24 14:32:09.713717+00', 'password', '581c398a-09ad-4478-86bb-2141a65b63d5'),
	('258de09f-deb7-4e99-ac6b-9b2b4f672074', '2026-01-24 14:34:54.837723+00', '2026-01-24 14:34:54.837723+00', 'password', '43a33406-0959-438e-8eb7-26eafc52f669'),
	('6e9716e3-1e6e-4148-996b-d25a59c9ca4a', '2026-01-24 14:35:07.73358+00', '2026-01-24 14:35:07.73358+00', 'password', '86129002-867a-47bc-a7ae-d85e44685c4a'),
	('8a893489-b7c0-4840-8139-679db0a90ddd', '2026-01-24 14:35:10.436469+00', '2026-01-24 14:35:10.436469+00', 'password', 'e883ff38-7d55-460b-86f4-7a281d89330e'),
	('6763001c-ef4d-4c59-b015-cdb53b3ab2ea', '2026-01-24 14:35:17.034615+00', '2026-01-24 14:35:17.034615+00', 'password', '4c19f839-d43c-4f36-a2e0-81bceb7a5412'),
	('65021528-7116-4cfb-bec9-d3bd54e1ba30', '2026-01-24 14:35:31.208943+00', '2026-01-24 14:35:31.208943+00', 'password', 'fdbbe8ec-1850-447d-bcd4-a0ac2348a522'),
	('86aaf621-f223-40f8-8424-c8c07a67b9fe', '2026-01-24 14:35:34.377607+00', '2026-01-24 14:35:34.377607+00', 'password', 'bf7e2a3a-bcd5-4646-9f6f-769563eb5f34'),
	('2dbde60e-9896-4c36-a1b9-6dc8f7905a43', '2026-01-24 14:35:39.395129+00', '2026-01-24 14:35:39.395129+00', 'password', '4409fe9b-d68a-49a0-95de-c87f7d69625e'),
	('281ee31c-9d10-4405-9409-fb047ad82912', '2026-01-24 14:35:52.330525+00', '2026-01-24 14:35:52.330525+00', 'password', 'fa6251ee-c343-43f3-a486-4448ec1b4f0b'),
	('538d36ba-de94-4aed-a0e5-628b39272e0d', '2026-01-24 14:35:55.300967+00', '2026-01-24 14:35:55.300967+00', 'password', '6f1e4487-443c-4a58-bb0d-b94ce1a5e04f'),
	('b824462f-753e-4750-9272-c2012ef1ae71', '2026-01-24 14:38:01.340106+00', '2026-01-24 14:38:01.340106+00', 'password', '71c3bd19-8398-4459-a73a-ab8ee1b51d51'),
	('41bdaae5-62bb-4e97-a3b4-0d92cb976e83', '2026-01-24 14:38:02.854647+00', '2026-01-24 14:38:02.854647+00', 'password', '5cfcf0fd-cfac-4e86-bfe5-6f555099e919'),
	('daf1443e-65b7-485c-93d3-8568e1344ecd', '2026-01-24 14:38:05.896268+00', '2026-01-24 14:38:05.896268+00', 'password', 'ea9f834b-7e42-440c-8805-f8486d9806de'),
	('43483934-7eaa-45a7-8d51-4587e2625bfe', '2026-01-24 14:38:10.841864+00', '2026-01-24 14:38:10.841864+00', 'password', '3e28a9bc-460f-407f-8d91-108892b4aae7'),
	('64a40430-db31-49e4-8c95-36a3117b41e2', '2026-01-24 14:38:12.496735+00', '2026-01-24 14:38:12.496735+00', 'password', '3c1713b8-e7fe-4690-a1b7-5e52bb0d164d'),
	('df2f1a03-4f4a-44fe-b1b8-4c3d562a9ff1', '2026-01-24 14:38:15.570421+00', '2026-01-24 14:38:15.570421+00', 'password', '861469d2-26b3-413e-bc58-cbaba6672c4c'),
	('229942f0-90b1-459c-bb08-a5aaf18f93e5', '2026-01-24 14:38:22.584777+00', '2026-01-24 14:38:22.584777+00', 'password', '72883fc1-1e0b-4ffb-80df-02b3a60bd64a'),
	('e5106c5d-d35a-41cb-a780-320d01b53d63', '2026-01-24 14:38:24.168027+00', '2026-01-24 14:38:24.168027+00', 'password', '6a14dd44-6ebe-4d58-9a0b-4fbb59be8771'),
	('c8c6c525-bfa4-4e07-9622-af27a7233f01', '2026-01-24 14:38:27.111653+00', '2026-01-24 14:38:27.111653+00', 'password', '96291cbd-b4d4-4e42-bc20-0b3c4074df54'),
	('2ec36887-d1db-49b5-9e4c-c01eb9fe823d', '2026-01-24 14:41:01.72391+00', '2026-01-24 14:41:01.72391+00', 'password', '4ca3415e-b5f5-4e11-84ef-1d4e25b1c0fd'),
	('f7fa63d9-a728-48c5-a2ca-be5c53335ee4', '2026-01-24 14:41:02.772884+00', '2026-01-24 14:41:02.772884+00', 'password', '776d5236-991b-476f-a01f-391d7bf835d1'),
	('0c39209d-98c7-4930-8513-1eab34f91c9a', '2026-01-24 14:41:05.404933+00', '2026-01-24 14:41:05.404933+00', 'password', '6ad98434-29b5-4b13-8539-697ca74b3334'),
	('d23d9aa5-4605-4392-b323-1cc6aa335d82', '2026-01-24 14:41:10.669979+00', '2026-01-24 14:41:10.669979+00', 'password', 'b5c5d41b-bfc2-4a90-8826-23e7dc685369'),
	('99d3dba8-f4b5-4ef7-b156-c20fc4384027', '2026-01-24 14:41:12.340592+00', '2026-01-24 14:41:12.340592+00', 'password', '5a8c1921-c823-4ee5-8111-351ee0c77236'),
	('e1c66b32-871a-43f8-b35b-07cf97446e56', '2026-01-24 14:41:16.020022+00', '2026-01-24 14:41:16.020022+00', 'password', '1b04d461-34a8-4326-9e42-547c4964e074'),
	('661d5c0e-84cf-4d0b-a306-dab2eff0c541', '2026-01-24 14:41:21.242643+00', '2026-01-24 14:41:21.242643+00', 'password', 'cc69c95d-87b8-4e69-867a-38c61f51d8b9'),
	('42e09b4e-6f48-4024-9778-9aef1566615a', '2026-01-24 14:41:22.944414+00', '2026-01-24 14:41:22.944414+00', 'password', '6efa5a24-d8c3-4c3a-9e6f-49dad84dd000'),
	('78f7d363-ce1b-4665-9c4e-5db6b80f94cd', '2026-01-24 14:41:26.568465+00', '2026-01-24 14:41:26.568465+00', 'password', 'f582a20d-3312-4f93-9286-67e6c0970a42'),
	('e348f455-d750-4ec4-9abd-5a4af9f470a2', '2026-01-24 14:43:51.179943+00', '2026-01-24 14:43:51.179943+00', 'password', '0487fd35-6754-4620-afbf-0bc3b680ecb8'),
	('3f6749b4-26d5-4415-ae99-778ae2783611', '2026-01-24 14:43:52.450773+00', '2026-01-24 14:43:52.450773+00', 'password', '239a9d88-8c08-44d4-ace8-93f378dfa2a0'),
	('7c1cdca1-5b1c-4cdd-8263-392decd83645', '2026-01-24 14:43:55.213026+00', '2026-01-24 14:43:55.213026+00', 'password', '62573de2-8777-4d9b-937e-0deb251e9a33'),
	('655f593c-da40-44f9-9ea5-9bdc94518db8', '2026-01-24 14:44:02.068946+00', '2026-01-24 14:44:02.068946+00', 'password', '1ed31f73-162c-46f7-a754-da4ce0980534'),
	('0695a29e-a5a2-47be-8fce-752c73e125a9', '2026-01-24 14:44:04.406517+00', '2026-01-24 14:44:04.406517+00', 'password', '2987ea5d-143f-41d3-ae11-3b83993fb7ad'),
	('28aa3c04-0f91-4238-8ade-ffd4b54498b3', '2026-01-24 14:44:08.16418+00', '2026-01-24 14:44:08.16418+00', 'password', '6ff39e2c-a946-44ed-9a12-4377ef526b7a'),
	('a57f2df0-f6f0-44bd-a7ba-c1565a6f7e1f', '2026-01-24 14:44:13.869242+00', '2026-01-24 14:44:13.869242+00', 'password', '895b3c72-4373-4162-a7df-ed644523a61b'),
	('98286ca3-7323-4bf9-9f4c-5a1979d19743', '2026-01-24 14:44:16.384+00', '2026-01-24 14:44:16.384+00', 'password', 'cc78b90e-c612-431e-b476-977412a2b0d5'),
	('31b4b478-a712-48a4-9ea3-c13672fa5423', '2026-01-24 14:44:19.379767+00', '2026-01-24 14:44:19.379767+00', 'password', 'ff55597d-bd2e-49f0-98ff-1db3a70443aa'),
	('9f9e88c7-ffc7-4b59-93a1-550267e60e09', '2026-01-24 14:44:23.284542+00', '2026-01-24 14:44:23.284542+00', 'password', 'e6d8287f-8127-4396-8a13-e406265b44d2'),
	('886bf48e-c381-47a8-bed8-21294966a6ab', '2026-01-24 14:44:24.287694+00', '2026-01-24 14:44:24.287694+00', 'password', '90c30082-6477-4f76-829d-ff799a901efb'),
	('0e3cf68f-a973-449d-aa56-7f536493e101', '2026-01-24 14:44:26.95997+00', '2026-01-24 14:44:26.95997+00', 'password', '1a0c3fcb-766c-49ae-bb55-28fd7f7c757d'),
	('695cea6b-5b4f-44dd-8cfa-e69cb543312a', '2026-01-24 14:44:31.355554+00', '2026-01-24 14:44:31.355554+00', 'password', 'f2f60c62-d404-4b35-9bf3-50badbdfccc2'),
	('df7e9389-53a9-4226-b402-7435ee02f2e8', '2026-01-24 14:44:33.958417+00', '2026-01-24 14:44:33.958417+00', 'password', '11641531-5293-4de5-ac41-15e19bb4879e'),
	('3a82ec2e-ceda-44cc-9f17-db7f85bc3eb3', '2026-01-24 14:44:37.164491+00', '2026-01-24 14:44:37.164491+00', 'password', 'c45aab4b-fe1e-458a-810a-e4f81a2ff28a'),
	('54b1d3ff-b570-4d41-9b78-1d05438bd4fb', '2026-01-24 14:44:41.484743+00', '2026-01-24 14:44:41.484743+00', 'password', 'bdb4d061-396e-409b-9955-52946952b898'),
	('ae75cd05-bc89-40fb-84a5-1c5a8f8112dc', '2026-01-24 14:44:42.635231+00', '2026-01-24 14:44:42.635231+00', 'password', 'b98e8b3f-80ef-4fb3-aa98-ead7859f9c18'),
	('f33d8d74-c768-4238-9fba-c74040aa0d85', '2026-01-24 14:44:45.345843+00', '2026-01-24 14:44:45.345843+00', 'password', 'b04d64cb-40da-43c7-b418-a3ff0160fb52'),
	('e5154485-8bd8-4fb0-9f7a-c4a60a97377a', '2026-01-24 14:44:48.530757+00', '2026-01-24 14:44:48.530757+00', 'password', 'fd4f99e1-b6bf-424e-882b-494b456fb0ae'),
	('1b06e909-979b-40eb-b8e1-08c6fa4222b6', '2026-01-24 14:44:49.744919+00', '2026-01-24 14:44:49.744919+00', 'password', '822cec14-ceff-4173-a126-f24a135615bd'),
	('16d644fb-016e-4cfa-be1a-490856e74c66', '2026-01-24 14:44:52.536438+00', '2026-01-24 14:44:52.536438+00', 'password', 'b536b83a-e568-4417-96e7-1b99d7cf71a8'),
	('a6b41c89-56f4-4dd7-9287-7b999935f0ac', '2026-01-24 14:44:55.893067+00', '2026-01-24 14:44:55.893067+00', 'password', 'ec65b54e-faf3-4428-93e6-292227845980'),
	('08f12703-4fe7-4781-9b86-67d21b1a999f', '2026-01-24 14:44:56.955721+00', '2026-01-24 14:44:56.955721+00', 'password', '18210439-8020-451e-9526-a57b8ecf6e67'),
	('94a19185-296b-4585-8c5b-95124ed880f7', '2026-01-24 14:45:00.279247+00', '2026-01-24 14:45:00.279247+00', 'password', 'd5dbefa7-a908-4e5e-adf7-b2bf066b6510'),
	('ea5e6a31-5df7-401f-b567-202adf5811c9', '2026-01-24 14:45:04.102018+00', '2026-01-24 14:45:04.102018+00', 'password', '75811481-02af-41d7-9551-99e795651ea0'),
	('2f97c556-5d94-4754-9d73-42aa8291a9e1', '2026-01-24 14:45:05.41061+00', '2026-01-24 14:45:05.41061+00', 'password', '8abedd8c-a616-42fe-bc45-8fdba0dcde5f'),
	('ae23cc63-431e-4b64-9eec-711de07eb140', '2026-01-24 14:45:08.111669+00', '2026-01-24 14:45:08.111669+00', 'password', 'df4440dd-0760-4e8e-8678-1eaaf7d6cdb1'),
	('aa607d65-529b-4861-8fb8-012ee6ea57c1', '2026-01-24 14:45:11.31431+00', '2026-01-24 14:45:11.31431+00', 'password', 'ab9778b4-f08f-49be-8081-c686cf1fd84c'),
	('74204515-e9ea-4113-bca4-40fc359259b5', '2026-01-24 14:45:12.363448+00', '2026-01-24 14:45:12.363448+00', 'password', 'f73fbf48-35d2-40ea-b063-7e396cdf86de'),
	('4aa9785f-8915-4c3a-bc89-247e270e3bee', '2026-01-24 14:45:15.044823+00', '2026-01-24 14:45:15.044823+00', 'password', '28c655ab-095e-46ff-8a56-f507bfee0787'),
	('ae940bde-0a11-4dd9-a42b-e7c73a1533d3', '2026-01-24 14:49:27.058128+00', '2026-01-24 14:49:27.058128+00', 'password', '14d90812-1739-4747-bbd6-12b9af4963f9'),
	('f269d1cf-638c-4a3b-9c46-287eb7bde1d1', '2026-01-24 14:49:29.056552+00', '2026-01-24 14:49:29.056552+00', 'password', '07c3737e-23df-4809-867c-758b39adcb9c'),
	('ec7a5341-eba8-4d4d-be7e-a485878aacbe', '2026-01-24 14:49:31.696731+00', '2026-01-24 14:49:31.696731+00', 'password', '2cd6507d-de19-4488-9aaa-27e920f1d0c7'),
	('380853ad-5d22-49e5-ab1d-2cbc7786f498', '2026-01-24 14:49:37.147428+00', '2026-01-24 14:49:37.147428+00', 'password', '359f3c14-2cdb-42de-b5d4-897d87d80970'),
	('bf1bf82b-c32d-45b0-808e-514739d7ed18', '2026-01-24 14:49:39.231056+00', '2026-01-24 14:49:39.231056+00', 'password', 'f952aa26-26e8-459a-92eb-0671b43c3b7d'),
	('f7ef9d1e-f5e6-4a06-9b1c-b59265cf3b83', '2026-01-24 14:49:42.55034+00', '2026-01-24 14:49:42.55034+00', 'password', '855b8762-fa66-4259-816f-bf9cfca61417'),
	('3f6c160f-cad3-4fb6-a5f7-a81eb27d70a0', '2026-01-24 14:49:48.41238+00', '2026-01-24 14:49:48.41238+00', 'password', 'a54405f3-fcec-42c6-b878-807728a74226'),
	('72e4ee3c-b972-423e-9572-6641e259cc39', '2026-01-24 14:49:50.894518+00', '2026-01-24 14:49:50.894518+00', 'password', '88237981-5c07-4189-b739-2b6ee7c09cd8'),
	('342417e7-39b9-4e8b-ae5e-74ea52edae68', '2026-01-24 14:49:53.759391+00', '2026-01-24 14:49:53.759391+00', 'password', 'f75f15fa-8912-45bd-aed1-82fe11fb3078'),
	('888161ef-00c3-49b7-ba88-6c88e0800638', '2026-01-24 14:49:57.301243+00', '2026-01-24 14:49:57.301243+00', 'password', '19ff9be6-37da-4123-8aec-7ed12ffa7030'),
	('4e4461ba-edfb-4475-9c70-0aedfbf25a2e', '2026-01-24 14:49:58.260582+00', '2026-01-24 14:49:58.260582+00', 'password', 'ba4e5998-5230-45fc-ab22-23d8f27d5be8'),
	('55f4ad1f-f89d-4df3-844b-7ad5748de91d', '2026-01-24 14:50:00.953726+00', '2026-01-24 14:50:00.953726+00', 'password', '9933e94d-d584-45d1-bcd1-b0f2da78445c'),
	('f9ecbf35-9571-49d3-84dc-f0945c730aaa', '2026-01-24 14:50:04.843728+00', '2026-01-24 14:50:04.843728+00', 'password', 'c3079a71-ae15-4791-b881-e7fdcc246423'),
	('a0191e58-e9ce-412d-86b4-b43fbe2ac118', '2026-01-24 14:50:06.422043+00', '2026-01-24 14:50:06.422043+00', 'password', '6b134337-1fb9-4297-8ec5-2f5d0d34136f'),
	('84e44e72-e59c-4051-b373-430407bdbf46', '2026-01-24 14:50:09.780255+00', '2026-01-24 14:50:09.780255+00', 'password', 'ecf157e2-eec5-47c2-b63b-b5ec75c56560'),
	('9b940eda-207d-48c5-a55d-2dd59062246e', '2026-01-24 14:50:12.711279+00', '2026-01-24 14:50:12.711279+00', 'password', '05f7f989-0e58-4f62-9e43-667a7bdc8ec8'),
	('99b2a645-014d-41d3-a79e-1be44d4b12a6', '2026-01-24 14:50:13.775818+00', '2026-01-24 14:50:13.775818+00', 'password', 'b4d53d53-d319-482f-abf4-bc2595f86f35'),
	('e3cffa69-7b74-4d8e-ba88-499a0a4578f1', '2026-01-24 14:50:16.446325+00', '2026-01-24 14:50:16.446325+00', 'password', '7666d24d-53d9-4da2-9f11-3eb185f3e22c'),
	('a5d659d3-1db6-4cb6-887d-1521740ec322', '2026-01-24 14:50:19.643356+00', '2026-01-24 14:50:19.643356+00', 'password', '9b5f848e-9b36-40e8-9a17-de6972bf627b'),
	('27bcc9d3-eaf3-4dcf-8d3b-d60b7714a5cc', '2026-01-24 14:50:20.931706+00', '2026-01-24 14:50:20.931706+00', 'password', '2af158b1-038f-4089-82eb-1205b094e533'),
	('0c9e7fdf-c98e-4097-af08-e38aeaf2d8eb', '2026-01-24 14:50:23.534909+00', '2026-01-24 14:50:23.534909+00', 'password', 'c59bce01-f518-4a5d-84a1-109d6c07502d'),
	('bb617bfd-28c4-45c4-a165-d33f272c30ba', '2026-01-24 14:50:26.531113+00', '2026-01-24 14:50:26.531113+00', 'password', '2e1c5ead-4865-4651-ab4e-5cef1618165d'),
	('0b6ac386-f620-40f7-ba17-60c9c25407ce', '2026-01-24 14:50:27.552207+00', '2026-01-24 14:50:27.552207+00', 'password', '8b3d8885-fc04-4d7c-93de-a4aaa477177c'),
	('8e41d94d-cc30-48a2-9b5e-2938b43a91e5', '2026-01-24 14:50:30.184828+00', '2026-01-24 14:50:30.184828+00', 'password', '3263685c-c4b7-4f25-8f59-6c8cbf61ca67'),
	('da11c6a3-d965-4a0f-be61-191f4be6c45e', '2026-01-24 14:50:33.471489+00', '2026-01-24 14:50:33.471489+00', 'password', 'cd63b506-518e-4f60-8de1-b811b1177b6a'),
	('066407a8-b555-451d-b00d-a0776483dd41', '2026-01-24 14:50:34.47775+00', '2026-01-24 14:50:34.47775+00', 'password', 'a7d7ee5c-9f77-44c5-b4cb-afeefbacb7cb'),
	('0164c032-7b7b-44f2-8745-f22db1263839', '2026-01-24 14:50:37.195546+00', '2026-01-24 14:50:37.195546+00', 'password', '95e46ebe-f10a-4712-8553-f499736d0804'),
	('fcfa4d09-2129-4696-8855-b7415aee98fd', '2026-01-24 14:50:40.083899+00', '2026-01-24 14:50:40.083899+00', 'password', '2324ac0c-1176-4ac6-b4c4-1508986f293a'),
	('304aa9c3-dcf1-4a1f-b349-b570b4a9f12f', '2026-01-24 14:50:41.12484+00', '2026-01-24 14:50:41.12484+00', 'password', '372f6955-4ace-41b0-855e-5d8a0e3b578f'),
	('9ac51b93-ed9a-4e8c-924d-2c92ccf95013', '2026-01-24 14:50:43.743921+00', '2026-01-24 14:50:43.743921+00', 'password', '3a770f51-1f51-405c-871e-8d4f9945e3e1'),
	('6ac7f656-30fd-47d1-a8dc-37d4a8f2ccb4', '2026-01-24 14:50:46.73875+00', '2026-01-24 14:50:46.73875+00', 'password', 'aa18b440-3381-4d9f-8fb0-5794bdd51778'),
	('5522a07a-a377-433d-b677-6bac7ef6ac1d', '2026-01-24 14:50:48.265989+00', '2026-01-24 14:50:48.265989+00', 'password', '42b32462-953d-482d-a0c1-365a8204b84b'),
	('c8853a2e-a7e7-43b3-a3f1-5781dcb1db73', '2026-01-24 14:50:51.108967+00', '2026-01-24 14:50:51.108967+00', 'password', 'c3eeef60-dc4c-4a81-a54a-1c38be831e23'),
	('8dc415b4-a7a4-4422-ad19-0b7d8d1faeee', '2026-01-24 14:50:53.992223+00', '2026-01-24 14:50:53.992223+00', 'password', 'c031a363-e758-4d67-8f78-5047d5b70f95'),
	('a84b6a9b-e93e-4199-8b2f-c4225972bf2a', '2026-01-24 14:50:55.523867+00', '2026-01-24 14:50:55.523867+00', 'password', '71a8257a-aa62-49ab-8263-53ef5d9fed39'),
	('fdc6f028-3f22-48d9-b24a-0b09be8bf8ae', '2026-01-24 14:50:58.585016+00', '2026-01-24 14:50:58.585016+00', 'password', '584b4222-ea4b-4bca-8c3d-577af48c41d0'),
	('5a3849b7-a6b8-4404-836d-1bfd5816eeb1', '2026-01-24 14:51:02.359969+00', '2026-01-24 14:51:02.359969+00', 'password', '21027bcf-15e6-4e5d-8f20-bc273db71eab'),
	('604ce3ed-a4dd-44a9-916f-ca2f9ca613ef', '2026-01-24 14:51:03.839603+00', '2026-01-24 14:51:03.839603+00', 'password', '11a7b030-d079-4428-9a05-5df8dc1f85b3'),
	('39b54740-fbf6-4781-876b-7f0f8f34b177', '2026-01-24 14:51:06.796926+00', '2026-01-24 14:51:06.796926+00', 'password', '83f0d421-d027-4e06-888a-0bb6df6a149f'),
	('510f09da-e0b9-45ff-a72b-cc791c113e27', '2026-01-24 14:51:11.072859+00', '2026-01-24 14:51:11.072859+00', 'password', '16f2035c-aeba-476c-b49c-0280e9d3e66a'),
	('3ba0576b-c505-42b7-adef-5cde0cee1f99', '2026-01-24 14:51:12.50203+00', '2026-01-24 14:51:12.50203+00', 'password', 'b8b7de38-fe91-4541-8bd9-ab39d92e6230'),
	('92b7aaff-02a4-4323-8517-f0049b387c34', '2026-01-24 14:51:16.034166+00', '2026-01-24 14:51:16.034166+00', 'password', '36fb61d5-d89b-4aee-83b7-7a4bdfcaee53'),
	('27e7bfed-4d32-4bb6-93f7-1cb2ab4a0bf1', '2026-01-24 14:51:19.322498+00', '2026-01-24 14:51:19.322498+00', 'password', '491d5797-3f66-4f71-a7d1-4bdbba644ae2'),
	('e46eb736-0c08-444d-8a5e-42f842dc32ec', '2026-01-24 14:51:20.819681+00', '2026-01-24 14:51:20.819681+00', 'password', '475e46a7-e52a-4410-a694-ebc9f180a195'),
	('e340da03-6740-411d-8f34-23daa204d4b0', '2026-01-24 14:51:23.693374+00', '2026-01-24 14:51:23.693374+00', 'password', '149a6164-3862-4eb6-bb88-bec79f3769ee'),
	('1d41ff06-386f-42e9-8d49-9ad36180bb5b', '2026-01-24 14:51:27.112252+00', '2026-01-24 14:51:27.112252+00', 'password', 'e75bf45e-d491-4b7e-bb8d-3a98ceae6284'),
	('3257fe8a-2d08-4786-a19c-b353733aa062', '2026-01-24 14:51:28.650591+00', '2026-01-24 14:51:28.650591+00', 'password', '7e00d506-eb07-4fbb-96dc-85a993105a1d'),
	('33a6a7a9-4bae-48e9-96e0-7bbd4ba7b3c7', '2026-01-24 14:51:32.59453+00', '2026-01-24 14:51:32.59453+00', 'password', '1aee7462-f826-4840-bb13-92d2cd0f7528');


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."refresh_tokens" ("instance_id", "id", "token", "user_id", "revoked", "created_at", "updated_at", "parent", "session_id") VALUES
	('00000000-0000-0000-0000-000000000000', 67, 'qltd4brygcyj', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:17:42.141422+00', '2026-01-24 14:17:42.141422+00', NULL, 'df7c8388-bfba-4900-ba55-7a385ac4b70b'),
	('00000000-0000-0000-0000-000000000000', 68, 'yzxx427sjpzp', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:17:49.818712+00', '2026-01-24 14:17:49.818712+00', NULL, 'b68208f2-19b7-450f-9a3b-a7a5b5f56663'),
	('00000000-0000-0000-0000-000000000000', 69, '6cwrvtibs6on', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:17:59.055421+00', '2026-01-24 14:17:59.055421+00', NULL, '343535f8-f77d-4cb7-8ba3-ea0d1e1552a1'),
	('00000000-0000-0000-0000-000000000000', 70, 'o33wrucurr65', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:18:04.337285+00', '2026-01-24 14:18:04.337285+00', NULL, '317367e7-7343-4ac0-8930-e347d964c97a'),
	('00000000-0000-0000-0000-000000000000', 71, 'fz4zbfonvi4h', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:18:12.955095+00', '2026-01-24 14:18:12.955095+00', NULL, 'fbe77f7d-8f79-4e0b-91ed-88cb62ae4809'),
	('00000000-0000-0000-0000-000000000000', 72, 'p2xyomainwin', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:18:23.546062+00', '2026-01-24 14:18:23.546062+00', NULL, '93693377-adf4-42a0-85cf-a9cab48c3379'),
	('00000000-0000-0000-0000-000000000000', 73, 'aihc7454eog2', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:18:28.445557+00', '2026-01-24 14:18:28.445557+00', NULL, 'b901b577-0365-4410-9ee3-1e57e1a9f229'),
	('00000000-0000-0000-0000-000000000000', 74, 'gtkwa6vqfb2n', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:18:35.809195+00', '2026-01-24 14:18:35.809195+00', NULL, 'fddae97d-e42b-4be1-9fe0-23be90c78da7'),
	('00000000-0000-0000-0000-000000000000', 75, 'ziibmwyp5ema', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:18:44.684403+00', '2026-01-24 14:18:44.684403+00', NULL, '0201b3b5-b21a-4fe5-8404-2dedd1209e6e'),
	('00000000-0000-0000-0000-000000000000', 76, 'fkkuw43imuj4', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:23:02.176929+00', '2026-01-24 14:23:02.176929+00', NULL, '3507fbd0-409a-4cc1-963a-ef412c0caccd'),
	('00000000-0000-0000-0000-000000000000', 77, 'v46jocb5jbax', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:23:09.772837+00', '2026-01-24 14:23:09.772837+00', NULL, 'adede784-da43-46ec-b52a-b664a5220815'),
	('00000000-0000-0000-0000-000000000000', 78, 'no6zawyrbuvl', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:23:14.843202+00', '2026-01-24 14:23:14.843202+00', NULL, '1217dbe2-95c8-40d7-81f6-f248b05f5790'),
	('00000000-0000-0000-0000-000000000000', 79, 'yvk7sabff3ie', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:23:25.697452+00', '2026-01-24 14:23:25.697452+00', NULL, '47e1893b-39bf-4581-898d-5c206ce23aa6'),
	('00000000-0000-0000-0000-000000000000', 80, 'bgnkf7mj6jpa', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:23:34.848978+00', '2026-01-24 14:23:34.848978+00', NULL, '78e129a3-4c4b-43fd-92d2-670c7ed5fa9a'),
	('00000000-0000-0000-0000-000000000000', 81, 'kqwfnwfwqpip', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:23:38.111549+00', '2026-01-24 14:23:38.111549+00', NULL, 'a06d6456-174a-4b44-8188-3a0a6c924064'),
	('00000000-0000-0000-0000-000000000000', 82, 'd76qoqfnr425', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:23:48.069793+00', '2026-01-24 14:23:48.069793+00', NULL, 'a77602d0-fc50-428a-a194-1e4be5e46eaa'),
	('00000000-0000-0000-0000-000000000000', 83, 'b6opgqwkorkf', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:23:55.593689+00', '2026-01-24 14:23:55.593689+00', NULL, '34627561-6bef-4b60-9ffe-79485c8d9e5a'),
	('00000000-0000-0000-0000-000000000000', 84, 'vpeqhwvaj7il', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:23:58.533416+00', '2026-01-24 14:23:58.533416+00', NULL, 'b4898214-c2d2-4ca5-9310-a5467d4f1c4a'),
	('00000000-0000-0000-0000-000000000000', 85, 'g7p2xaggieog', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:28:13.306149+00', '2026-01-24 14:28:13.306149+00', NULL, '81798fc4-576b-4fc0-89b2-68317faba5e3'),
	('00000000-0000-0000-0000-000000000000', 86, 'iiju44utyhxu', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:28:20.727642+00', '2026-01-24 14:28:20.727642+00', NULL, '0b873f27-9b8c-4087-ba8e-56b1344f4e4d'),
	('00000000-0000-0000-0000-000000000000', 87, 'b2c6cfwsfnwj', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:28:25.756308+00', '2026-01-24 14:28:25.756308+00', NULL, '90861416-7a58-42eb-aada-571dfa9c3fe0'),
	('00000000-0000-0000-0000-000000000000', 88, 'r3l6qj3ughf7', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:28:31.689645+00', '2026-01-24 14:28:31.689645+00', NULL, 'cadb863e-b009-4062-b412-9e776f1c3f45'),
	('00000000-0000-0000-0000-000000000000', 89, 'b6qirbtjnmml', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:28:41.268606+00', '2026-01-24 14:28:41.268606+00', NULL, '4652f440-0bca-41bb-bbb0-6ff2d1d0b2d7'),
	('00000000-0000-0000-0000-000000000000', 90, 'r5bz327cfdnd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:28:44.637955+00', '2026-01-24 14:28:44.637955+00', NULL, 'aae80b8f-1b68-4f91-a71d-889588c2e375'),
	('00000000-0000-0000-0000-000000000000', 91, 'm5bup777ogtl', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:28:50.366532+00', '2026-01-24 14:28:50.366532+00', NULL, 'ae920302-c321-452e-b340-517f013cdc52'),
	('00000000-0000-0000-0000-000000000000', 92, 'dwuua4qlobr4', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:28:59.108606+00', '2026-01-24 14:28:59.108606+00', NULL, 'a7cbb3fc-3009-4889-aaf4-dcfafa1c5cc3'),
	('00000000-0000-0000-0000-000000000000', 93, 'qmw7ixlesklz', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:29:02.649589+00', '2026-01-24 14:29:02.649589+00', NULL, 'c7df5b80-d9c0-46a8-984f-f944b2eb2173'),
	('00000000-0000-0000-0000-000000000000', 94, 'a6q2ek5bkdoj', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:30:41.929845+00', '2026-01-24 14:30:41.929845+00', NULL, '66ecde68-59f4-44d5-9070-17ef84a4adc0'),
	('00000000-0000-0000-0000-000000000000', 95, 'b7svxbxhnjup', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:31:27.999334+00', '2026-01-24 14:31:27.999334+00', NULL, '6f4e0784-11e5-4d07-a6f2-c31bb6bef839'),
	('00000000-0000-0000-0000-000000000000', 96, 'x347hnemxava', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:31:34.769315+00', '2026-01-24 14:31:34.769315+00', NULL, 'df2d3e26-4501-4886-8272-df906de6898e'),
	('00000000-0000-0000-0000-000000000000', 97, 'h2aagas5xcdw', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:31:37.437964+00', '2026-01-24 14:31:37.437964+00', NULL, 'e31c6b67-6ed5-4811-8b19-d832192aa007'),
	('00000000-0000-0000-0000-000000000000', 51, 'pdozbt34kdii', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', true, '2026-01-23 16:17:10.280821+00', '2026-01-23 17:25:18.533623+00', NULL, '762472e7-a8f4-4bb7-b3a0-edc960ac9440'),
	('00000000-0000-0000-0000-000000000000', 98, 'uppye3pvo7jd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:31:42.207133+00', '2026-01-24 14:31:42.207133+00', NULL, 'ca41846f-aacd-485c-a936-3f1bbefc359b'),
	('00000000-0000-0000-0000-000000000000', 54, 'fbaksrzhnovg', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', true, '2026-01-23 17:25:18.559291+00', '2026-01-24 10:52:54.801639+00', 'pdozbt34kdii', '762472e7-a8f4-4bb7-b3a0-edc960ac9440'),
	('00000000-0000-0000-0000-000000000000', 99, 'gpfpzaufnu6p', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:31:51.804709+00', '2026-01-24 14:31:51.804709+00', NULL, '2a1abe4b-7e85-4720-8401-31dc8b0a34f0'),
	('00000000-0000-0000-0000-000000000000', 100, 'vnjszimyyhek', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:31:54.916335+00', '2026-01-24 14:31:54.916335+00', NULL, '7961b6ef-1d36-4caa-a9f0-e71b1aa09a7b'),
	('00000000-0000-0000-0000-000000000000', 101, 'ouyxdsicoi4k', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:31:59.464924+00', '2026-01-24 14:31:59.464924+00', NULL, 'bccf5a7b-6744-4248-85f5-2220f1d633e0'),
	('00000000-0000-0000-0000-000000000000', 55, 'ploqobbgxy4j', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', true, '2026-01-24 10:52:54.818915+00', '2026-01-24 11:51:22.51928+00', 'fbaksrzhnovg', '762472e7-a8f4-4bb7-b3a0-edc960ac9440'),
	('00000000-0000-0000-0000-000000000000', 102, 'amxsljjuikuy', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:32:06.810355+00', '2026-01-24 14:32:06.810355+00', NULL, '1717456a-d679-4b04-ab1b-7eb2a014f54c'),
	('00000000-0000-0000-0000-000000000000', 103, '5llzjh6ch4qi', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:32:09.712685+00', '2026-01-24 14:32:09.712685+00', NULL, 'c108eba1-4a4b-425e-b739-ac9358b10a68'),
	('00000000-0000-0000-0000-000000000000', 104, 'i4vnmiul77ik', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:34:54.826444+00', '2026-01-24 14:34:54.826444+00', NULL, '258de09f-deb7-4e99-ac6b-9b2b4f672074'),
	('00000000-0000-0000-0000-000000000000', 57, 'yiuxyq6ykzhf', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', true, '2026-01-24 11:51:22.542493+00', '2026-01-24 12:49:35.063704+00', 'ploqobbgxy4j', '762472e7-a8f4-4bb7-b3a0-edc960ac9440'),
	('00000000-0000-0000-0000-000000000000', 105, 'dkyql2f3qdnb', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:35:07.732275+00', '2026-01-24 14:35:07.732275+00', NULL, '6e9716e3-1e6e-4148-996b-d25a59c9ca4a'),
	('00000000-0000-0000-0000-000000000000', 106, 'qtiw5esdenql', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:35:10.435172+00', '2026-01-24 14:35:10.435172+00', NULL, '8a893489-b7c0-4840-8139-679db0a90ddd'),
	('00000000-0000-0000-0000-000000000000', 107, 'icyf4chufd6p', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:35:17.032523+00', '2026-01-24 14:35:17.032523+00', NULL, '6763001c-ef4d-4c59-b015-cdb53b3ab2ea'),
	('00000000-0000-0000-0000-000000000000', 108, '4hmrxqwa45ho', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:35:31.207776+00', '2026-01-24 14:35:31.207776+00', NULL, '65021528-7116-4cfb-bec9-d3bd54e1ba30'),
	('00000000-0000-0000-0000-000000000000', 109, '4ct6isz5sdpn', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:35:34.375601+00', '2026-01-24 14:35:34.375601+00', NULL, '86aaf621-f223-40f8-8424-c8c07a67b9fe'),
	('00000000-0000-0000-0000-000000000000', 110, 'uemep2vruu2n', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:35:39.391239+00', '2026-01-24 14:35:39.391239+00', NULL, '2dbde60e-9896-4c36-a1b9-6dc8f7905a43'),
	('00000000-0000-0000-0000-000000000000', 111, 'l3acpcb5kfed', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:35:52.327161+00', '2026-01-24 14:35:52.327161+00', NULL, '281ee31c-9d10-4405-9409-fb047ad82912'),
	('00000000-0000-0000-0000-000000000000', 112, 'sxsrctcl4vjd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:35:55.299837+00', '2026-01-24 14:35:55.299837+00', NULL, '538d36ba-de94-4aed-a0e5-628b39272e0d'),
	('00000000-0000-0000-0000-000000000000', 113, 'obmpjyjbpbdy', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:38:01.337377+00', '2026-01-24 14:38:01.337377+00', NULL, 'b824462f-753e-4750-9272-c2012ef1ae71'),
	('00000000-0000-0000-0000-000000000000', 66, 'sfbgzlletwdi', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', true, '2026-01-24 13:47:56.885458+00', '2026-01-24 16:18:22.094748+00', 'owqyub2sdjv5', '762472e7-a8f4-4bb7-b3a0-edc960ac9440'),
	('00000000-0000-0000-0000-000000000000', 59, 'owqyub2sdjv5', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', true, '2026-01-24 12:49:35.074873+00', '2026-01-24 13:47:56.883225+00', 'yiuxyq6ykzhf', '762472e7-a8f4-4bb7-b3a0-edc960ac9440'),
	('00000000-0000-0000-0000-000000000000', 114, '5ilj7z6majdn', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:38:02.852557+00', '2026-01-24 14:38:02.852557+00', NULL, '41bdaae5-62bb-4e97-a3b4-0d92cb976e83'),
	('00000000-0000-0000-0000-000000000000', 115, '6ihbl7veim32', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:38:05.895059+00', '2026-01-24 14:38:05.895059+00', NULL, 'daf1443e-65b7-485c-93d3-8568e1344ecd'),
	('00000000-0000-0000-0000-000000000000', 116, 'usmnwabcblkc', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:38:10.840672+00', '2026-01-24 14:38:10.840672+00', NULL, '43483934-7eaa-45a7-8d51-4587e2625bfe'),
	('00000000-0000-0000-0000-000000000000', 117, 'uswwf7b6xj4p', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:38:12.495552+00', '2026-01-24 14:38:12.495552+00', NULL, '64a40430-db31-49e4-8c95-36a3117b41e2'),
	('00000000-0000-0000-0000-000000000000', 118, 'o6iaeg3kmtwu', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:38:15.567771+00', '2026-01-24 14:38:15.567771+00', NULL, 'df2f1a03-4f4a-44fe-b1b8-4c3d562a9ff1'),
	('00000000-0000-0000-0000-000000000000', 119, 'mpulibky55cq', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:38:22.583612+00', '2026-01-24 14:38:22.583612+00', NULL, '229942f0-90b1-459c-bb08-a5aaf18f93e5'),
	('00000000-0000-0000-0000-000000000000', 120, 'ylnnkc4aevxt', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:38:24.16689+00', '2026-01-24 14:38:24.16689+00', NULL, 'e5106c5d-d35a-41cb-a780-320d01b53d63'),
	('00000000-0000-0000-0000-000000000000', 121, '62xfxbzc2wz7', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:38:27.110481+00', '2026-01-24 14:38:27.110481+00', NULL, 'c8c6c525-bfa4-4e07-9622-af27a7233f01'),
	('00000000-0000-0000-0000-000000000000', 122, 'bpeodmhtceed', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:41:01.720487+00', '2026-01-24 14:41:01.720487+00', NULL, '2ec36887-d1db-49b5-9e4c-c01eb9fe823d'),
	('00000000-0000-0000-0000-000000000000', 123, 'qy7pveqkt4bi', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:41:02.771653+00', '2026-01-24 14:41:02.771653+00', NULL, 'f7fa63d9-a728-48c5-a2ca-be5c53335ee4'),
	('00000000-0000-0000-0000-000000000000', 124, '26jcuk2g5zsc', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:41:05.40362+00', '2026-01-24 14:41:05.40362+00', NULL, '0c39209d-98c7-4930-8513-1eab34f91c9a'),
	('00000000-0000-0000-0000-000000000000', 125, 'nb2oiosckgne', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:41:10.668808+00', '2026-01-24 14:41:10.668808+00', NULL, 'd23d9aa5-4605-4392-b323-1cc6aa335d82'),
	('00000000-0000-0000-0000-000000000000', 126, 'jia24x5xsxgh', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:41:12.339404+00', '2026-01-24 14:41:12.339404+00', NULL, '99d3dba8-f4b5-4ef7-b156-c20fc4384027'),
	('00000000-0000-0000-0000-000000000000', 127, 'cn4gjlhsqzqq', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:41:16.018781+00', '2026-01-24 14:41:16.018781+00', NULL, 'e1c66b32-871a-43f8-b35b-07cf97446e56'),
	('00000000-0000-0000-0000-000000000000', 128, 'ci5ucg6khsfr', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:41:21.241352+00', '2026-01-24 14:41:21.241352+00', NULL, '661d5c0e-84cf-4d0b-a306-dab2eff0c541'),
	('00000000-0000-0000-0000-000000000000', 129, '27eqlb4e33mf', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:41:22.94331+00', '2026-01-24 14:41:22.94331+00', NULL, '42e09b4e-6f48-4024-9778-9aef1566615a'),
	('00000000-0000-0000-0000-000000000000', 130, 'q7mnsv3drlwa', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:41:26.567334+00', '2026-01-24 14:41:26.567334+00', NULL, '78f7d363-ce1b-4665-9c4e-5db6b80f94cd'),
	('00000000-0000-0000-0000-000000000000', 131, '4i334dx5vwqc', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:43:51.164892+00', '2026-01-24 14:43:51.164892+00', NULL, 'e348f455-d750-4ec4-9abd-5a4af9f470a2'),
	('00000000-0000-0000-0000-000000000000', 132, '6fxpnj3qs7yy', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:43:52.449371+00', '2026-01-24 14:43:52.449371+00', NULL, '3f6749b4-26d5-4415-ae99-778ae2783611'),
	('00000000-0000-0000-0000-000000000000', 133, 'medrebb2qinp', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:43:55.211696+00', '2026-01-24 14:43:55.211696+00', NULL, '7c1cdca1-5b1c-4cdd-8263-392decd83645'),
	('00000000-0000-0000-0000-000000000000', 134, 'eln2nl43gfhd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:02.066966+00', '2026-01-24 14:44:02.066966+00', NULL, '655f593c-da40-44f9-9ea5-9bdc94518db8'),
	('00000000-0000-0000-0000-000000000000', 135, '2dxzjqow7j7k', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:04.405251+00', '2026-01-24 14:44:04.405251+00', NULL, '0695a29e-a5a2-47be-8fce-752c73e125a9'),
	('00000000-0000-0000-0000-000000000000', 136, '2fy7ztwjcqcb', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:08.157091+00', '2026-01-24 14:44:08.157091+00', NULL, '28aa3c04-0f91-4238-8ade-ffd4b54498b3'),
	('00000000-0000-0000-0000-000000000000', 137, 'a7htoqast76g', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:13.867957+00', '2026-01-24 14:44:13.867957+00', NULL, 'a57f2df0-f6f0-44bd-a7ba-c1565a6f7e1f'),
	('00000000-0000-0000-0000-000000000000', 138, 'asizfi5kgw7v', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:16.382807+00', '2026-01-24 14:44:16.382807+00', NULL, '98286ca3-7323-4bf9-9f4c-5a1979d19743'),
	('00000000-0000-0000-0000-000000000000', 139, 'zpdnowjci3fy', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:19.378581+00', '2026-01-24 14:44:19.378581+00', NULL, '31b4b478-a712-48a4-9ea3-c13672fa5423'),
	('00000000-0000-0000-0000-000000000000', 140, 'rpfkwoie2eqi', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:23.283276+00', '2026-01-24 14:44:23.283276+00', NULL, '9f9e88c7-ffc7-4b59-93a1-550267e60e09'),
	('00000000-0000-0000-0000-000000000000', 141, 'mu3fhvfiae4t', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:24.286341+00', '2026-01-24 14:44:24.286341+00', NULL, '886bf48e-c381-47a8-bed8-21294966a6ab'),
	('00000000-0000-0000-0000-000000000000', 142, 'u34zgcet4w4t', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:26.958774+00', '2026-01-24 14:44:26.958774+00', NULL, '0e3cf68f-a973-449d-aa56-7f536493e101'),
	('00000000-0000-0000-0000-000000000000', 143, 'o5pioq4uslfi', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:31.353806+00', '2026-01-24 14:44:31.353806+00', NULL, '695cea6b-5b4f-44dd-8cfa-e69cb543312a'),
	('00000000-0000-0000-0000-000000000000', 144, 'fyol4mfcakjs', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:33.957242+00', '2026-01-24 14:44:33.957242+00', NULL, 'df7e9389-53a9-4226-b402-7435ee02f2e8'),
	('00000000-0000-0000-0000-000000000000', 145, 'jjnyihufbgai', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:37.163435+00', '2026-01-24 14:44:37.163435+00', NULL, '3a82ec2e-ceda-44cc-9f17-db7f85bc3eb3'),
	('00000000-0000-0000-0000-000000000000', 146, 'crlru5azlhfj', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:41.483602+00', '2026-01-24 14:44:41.483602+00', NULL, '54b1d3ff-b570-4d41-9b78-1d05438bd4fb'),
	('00000000-0000-0000-0000-000000000000', 147, 'ifv4yjzumw5k', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:42.634134+00', '2026-01-24 14:44:42.634134+00', NULL, 'ae75cd05-bc89-40fb-84a5-1c5a8f8112dc'),
	('00000000-0000-0000-0000-000000000000', 148, 'kal227q7yjdd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:45.344776+00', '2026-01-24 14:44:45.344776+00', NULL, 'f33d8d74-c768-4238-9fba-c74040aa0d85'),
	('00000000-0000-0000-0000-000000000000', 149, 'ps3z6ig7imd3', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:48.525807+00', '2026-01-24 14:44:48.525807+00', NULL, 'e5154485-8bd8-4fb0-9f7a-c4a60a97377a'),
	('00000000-0000-0000-0000-000000000000', 150, '35dutq2pcbhs', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:49.743785+00', '2026-01-24 14:44:49.743785+00', NULL, '1b06e909-979b-40eb-b8e1-08c6fa4222b6'),
	('00000000-0000-0000-0000-000000000000', 151, '53ys4bvmeboy', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:52.535305+00', '2026-01-24 14:44:52.535305+00', NULL, '16d644fb-016e-4cfa-be1a-490856e74c66'),
	('00000000-0000-0000-0000-000000000000', 152, 'vsq375fmxcjv', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:55.891852+00', '2026-01-24 14:44:55.891852+00', NULL, 'a6b41c89-56f4-4dd7-9287-7b999935f0ac'),
	('00000000-0000-0000-0000-000000000000', 153, 'ss4txhigfeqw', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:44:56.953744+00', '2026-01-24 14:44:56.953744+00', NULL, '08f12703-4fe7-4781-9b86-67d21b1a999f'),
	('00000000-0000-0000-0000-000000000000', 154, 'jd62oc6gyy4p', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:45:00.278073+00', '2026-01-24 14:45:00.278073+00', NULL, '94a19185-296b-4585-8c5b-95124ed880f7'),
	('00000000-0000-0000-0000-000000000000', 155, 'sxtnlnag7bdp', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:45:04.100937+00', '2026-01-24 14:45:04.100937+00', NULL, 'ea5e6a31-5df7-401f-b567-202adf5811c9'),
	('00000000-0000-0000-0000-000000000000', 156, 'qleqdu6umes7', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:45:05.409283+00', '2026-01-24 14:45:05.409283+00', NULL, '2f97c556-5d94-4754-9d73-42aa8291a9e1'),
	('00000000-0000-0000-0000-000000000000', 157, 'n4bfouf2snca', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:45:08.110516+00', '2026-01-24 14:45:08.110516+00', NULL, 'ae23cc63-431e-4b64-9eec-711de07eb140'),
	('00000000-0000-0000-0000-000000000000', 158, 'zrfoadxmh5ug', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:45:11.312472+00', '2026-01-24 14:45:11.312472+00', NULL, 'aa607d65-529b-4861-8fb8-012ee6ea57c1'),
	('00000000-0000-0000-0000-000000000000', 159, 'kbltox3j6hjl', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:45:12.362233+00', '2026-01-24 14:45:12.362233+00', NULL, '74204515-e9ea-4113-bca4-40fc359259b5'),
	('00000000-0000-0000-0000-000000000000', 160, 'hw35pkiz4fmu', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:45:15.043698+00', '2026-01-24 14:45:15.043698+00', NULL, '4aa9785f-8915-4c3a-bc89-247e270e3bee'),
	('00000000-0000-0000-0000-000000000000', 161, '4mkhrxgykfl3', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:27.055318+00', '2026-01-24 14:49:27.055318+00', NULL, 'ae940bde-0a11-4dd9-a42b-e7c73a1533d3'),
	('00000000-0000-0000-0000-000000000000', 162, 'etajw2khjpyv', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:29.055175+00', '2026-01-24 14:49:29.055175+00', NULL, 'f269d1cf-638c-4a3b-9c46-287eb7bde1d1'),
	('00000000-0000-0000-0000-000000000000', 163, 'klzmg5kq2uji', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:31.695419+00', '2026-01-24 14:49:31.695419+00', NULL, 'ec7a5341-eba8-4d4d-be7e-a485878aacbe'),
	('00000000-0000-0000-0000-000000000000', 164, 'tru7lrcrl5xl', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:37.146201+00', '2026-01-24 14:49:37.146201+00', NULL, '380853ad-5d22-49e5-ab1d-2cbc7786f498'),
	('00000000-0000-0000-0000-000000000000', 165, 'bbzqf6wqoldt', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:39.229882+00', '2026-01-24 14:49:39.229882+00', NULL, 'bf1bf82b-c32d-45b0-808e-514739d7ed18'),
	('00000000-0000-0000-0000-000000000000', 166, 'pdcxs3cdrwic', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:42.549103+00', '2026-01-24 14:49:42.549103+00', NULL, 'f7ef9d1e-f5e6-4a06-9b1c-b59265cf3b83'),
	('00000000-0000-0000-0000-000000000000', 167, 'pz6egtlkmptf', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:48.411219+00', '2026-01-24 14:49:48.411219+00', NULL, '3f6c160f-cad3-4fb6-a5f7-a81eb27d70a0'),
	('00000000-0000-0000-0000-000000000000', 168, 'zym3tjnzczf6', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:50.893373+00', '2026-01-24 14:49:50.893373+00', NULL, '72e4ee3c-b972-423e-9572-6641e259cc39'),
	('00000000-0000-0000-0000-000000000000', 169, 'wzxtpap7yvst', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:53.756681+00', '2026-01-24 14:49:53.756681+00', NULL, '342417e7-39b9-4e8b-ae5e-74ea52edae68'),
	('00000000-0000-0000-0000-000000000000', 170, '47m5br55ttvj', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:57.300089+00', '2026-01-24 14:49:57.300089+00', NULL, '888161ef-00c3-49b7-ba88-6c88e0800638'),
	('00000000-0000-0000-0000-000000000000', 171, 'fwy5nnqvvkj3', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:49:58.25943+00', '2026-01-24 14:49:58.25943+00', NULL, '4e4461ba-edfb-4475-9c70-0aedfbf25a2e'),
	('00000000-0000-0000-0000-000000000000', 172, 'ghrwhdaxhzjv', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:00.952624+00', '2026-01-24 14:50:00.952624+00', NULL, '55f4ad1f-f89d-4df3-844b-7ad5748de91d'),
	('00000000-0000-0000-0000-000000000000', 173, '56nbymfhesxh', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:04.842512+00', '2026-01-24 14:50:04.842512+00', NULL, 'f9ecbf35-9571-49d3-84dc-f0945c730aaa'),
	('00000000-0000-0000-0000-000000000000', 174, 'kkedmhx6ugvy', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:06.420933+00', '2026-01-24 14:50:06.420933+00', NULL, 'a0191e58-e9ce-412d-86b4-b43fbe2ac118'),
	('00000000-0000-0000-0000-000000000000', 175, 'm44wymaadzqf', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:09.779186+00', '2026-01-24 14:50:09.779186+00', NULL, '84e44e72-e59c-4051-b373-430407bdbf46'),
	('00000000-0000-0000-0000-000000000000', 176, 'hjezupqcwtsr', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:12.710132+00', '2026-01-24 14:50:12.710132+00', NULL, '9b940eda-207d-48c5-a55d-2dd59062246e'),
	('00000000-0000-0000-0000-000000000000', 177, 'i4ijbhcoiu7u', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:13.774752+00', '2026-01-24 14:50:13.774752+00', NULL, '99b2a645-014d-41d3-a79e-1be44d4b12a6'),
	('00000000-0000-0000-0000-000000000000', 178, 'nselaabv6aw6', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:16.445203+00', '2026-01-24 14:50:16.445203+00', NULL, 'e3cffa69-7b74-4d8e-ba88-499a0a4578f1'),
	('00000000-0000-0000-0000-000000000000', 179, 'yoqki7vjibix', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:19.642185+00', '2026-01-24 14:50:19.642185+00', NULL, 'a5d659d3-1db6-4cb6-887d-1521740ec322'),
	('00000000-0000-0000-0000-000000000000', 180, 'eqiptsy2lxd7', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:20.930542+00', '2026-01-24 14:50:20.930542+00', NULL, '27bcc9d3-eaf3-4dcf-8d3b-d60b7714a5cc'),
	('00000000-0000-0000-0000-000000000000', 181, 'ldzrlobbyma7', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:23.533821+00', '2026-01-24 14:50:23.533821+00', NULL, '0c9e7fdf-c98e-4097-af08-e38aeaf2d8eb'),
	('00000000-0000-0000-0000-000000000000', 182, 'qcaqemxdrwo6', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:26.529961+00', '2026-01-24 14:50:26.529961+00', NULL, 'bb617bfd-28c4-45c4-a165-d33f272c30ba'),
	('00000000-0000-0000-0000-000000000000', 183, 'bs4t3b73ces6', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:27.551094+00', '2026-01-24 14:50:27.551094+00', NULL, '0b6ac386-f620-40f7-ba17-60c9c25407ce'),
	('00000000-0000-0000-0000-000000000000', 184, '2rn2chwo7kyj', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:30.183744+00', '2026-01-24 14:50:30.183744+00', NULL, '8e41d94d-cc30-48a2-9b5e-2938b43a91e5'),
	('00000000-0000-0000-0000-000000000000', 185, 'wxkrl3zui3pj', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:33.469715+00', '2026-01-24 14:50:33.469715+00', NULL, 'da11c6a3-d965-4a0f-be61-191f4be6c45e'),
	('00000000-0000-0000-0000-000000000000', 186, 'xx5jiskqyiiu', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:34.4766+00', '2026-01-24 14:50:34.4766+00', NULL, '066407a8-b555-451d-b00d-a0776483dd41'),
	('00000000-0000-0000-0000-000000000000', 187, 'nmqrtjwappuu', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:37.194345+00', '2026-01-24 14:50:37.194345+00', NULL, '0164c032-7b7b-44f2-8745-f22db1263839'),
	('00000000-0000-0000-0000-000000000000', 188, 'jx2knuwhsi5a', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:40.080823+00', '2026-01-24 14:50:40.080823+00', NULL, 'fcfa4d09-2129-4696-8855-b7415aee98fd'),
	('00000000-0000-0000-0000-000000000000', 189, 'qqjudbxcme4r', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:41.123688+00', '2026-01-24 14:50:41.123688+00', NULL, '304aa9c3-dcf1-4a1f-b349-b570b4a9f12f'),
	('00000000-0000-0000-0000-000000000000', 190, 'outpvuoelmfl', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:43.742822+00', '2026-01-24 14:50:43.742822+00', NULL, '9ac51b93-ed9a-4e8c-924d-2c92ccf95013'),
	('00000000-0000-0000-0000-000000000000', 191, 'knpf5uaifokz', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:46.737553+00', '2026-01-24 14:50:46.737553+00', NULL, '6ac7f656-30fd-47d1-a8dc-37d4a8f2ccb4'),
	('00000000-0000-0000-0000-000000000000', 192, 'phw5hknxqejs', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:48.2649+00', '2026-01-24 14:50:48.2649+00', NULL, '5522a07a-a377-433d-b677-6bac7ef6ac1d'),
	('00000000-0000-0000-0000-000000000000', 193, 'g3fpljlwr4cs', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:51.107907+00', '2026-01-24 14:50:51.107907+00', NULL, 'c8853a2e-a7e7-43b3-a3f1-5781dcb1db73'),
	('00000000-0000-0000-0000-000000000000', 194, 'whtp37cbi7u5', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:53.990984+00', '2026-01-24 14:50:53.990984+00', NULL, '8dc415b4-a7a4-4422-ad19-0b7d8d1faeee'),
	('00000000-0000-0000-0000-000000000000', 195, 'mkbaeep6ppp6', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:55.522777+00', '2026-01-24 14:50:55.522777+00', NULL, 'a84b6a9b-e93e-4199-8b2f-c4225972bf2a'),
	('00000000-0000-0000-0000-000000000000', 196, 'ig62tsbxflit', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:50:58.583759+00', '2026-01-24 14:50:58.583759+00', NULL, 'fdc6f028-3f22-48d9-b24a-0b09be8bf8ae'),
	('00000000-0000-0000-0000-000000000000', 197, 'hi6qykoclo55', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:02.358883+00', '2026-01-24 14:51:02.358883+00', NULL, '5a3849b7-a6b8-4404-836d-1bfd5816eeb1'),
	('00000000-0000-0000-0000-000000000000', 198, 'ih6rfnr6akvj', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:03.838441+00', '2026-01-24 14:51:03.838441+00', NULL, '604ce3ed-a4dd-44a9-916f-ca2f9ca613ef'),
	('00000000-0000-0000-0000-000000000000', 199, 'wafufy7ffrez', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:06.791836+00', '2026-01-24 14:51:06.791836+00', NULL, '39b54740-fbf6-4781-876b-7f0f8f34b177'),
	('00000000-0000-0000-0000-000000000000', 200, 'kuw55hojgtkv', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:11.054452+00', '2026-01-24 14:51:11.054452+00', NULL, '510f09da-e0b9-45ff-a72b-cc791c113e27'),
	('00000000-0000-0000-0000-000000000000', 201, 'eq6vxzno5vl3', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:12.49818+00', '2026-01-24 14:51:12.49818+00', NULL, '3ba0576b-c505-42b7-adef-5cde0cee1f99'),
	('00000000-0000-0000-0000-000000000000', 202, 'et5wru2wx67g', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:16.030946+00', '2026-01-24 14:51:16.030946+00', NULL, '92b7aaff-02a4-4323-8517-f0049b387c34'),
	('00000000-0000-0000-0000-000000000000', 203, 'u2uah7wbagcq', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:19.321234+00', '2026-01-24 14:51:19.321234+00', NULL, '27e7bfed-4d32-4bb6-93f7-1cb2ab4a0bf1'),
	('00000000-0000-0000-0000-000000000000', 204, 'llhms6ezpssu', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:20.818298+00', '2026-01-24 14:51:20.818298+00', NULL, 'e46eb736-0c08-444d-8a5e-42f842dc32ec'),
	('00000000-0000-0000-0000-000000000000', 205, 'tvoi4tfskz52', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:23.691972+00', '2026-01-24 14:51:23.691972+00', NULL, 'e340da03-6740-411d-8f34-23daa204d4b0'),
	('00000000-0000-0000-0000-000000000000', 206, '2jb5pk4kt4fk', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:27.111093+00', '2026-01-24 14:51:27.111093+00', NULL, '1d41ff06-386f-42e9-8d49-9ad36180bb5b'),
	('00000000-0000-0000-0000-000000000000', 207, 'xbqi3ltvkfip', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:28.648631+00', '2026-01-24 14:51:28.648631+00', NULL, '3257fe8a-2d08-4786-a19c-b353733aa062'),
	('00000000-0000-0000-0000-000000000000', 208, 'ip2z6pria2qw', 'b5bc17ad-e050-4f74-9205-5147ec350d83', false, '2026-01-24 14:51:32.592094+00', '2026-01-24 14:51:32.592094+00', NULL, '33a6a7a9-4bae-48e9-96e0-7bbd4ba7b3c7'),
	('00000000-0000-0000-0000-000000000000', 209, 'ruo3cstwbepz', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', false, '2026-01-24 16:18:22.101542+00', '2026-01-24 16:18:22.101542+00', 'sfbgzlletwdi', '762472e7-a8f4-4bb7-b3a0-edc960ac9440');


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: artists; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."artists" ("id", "slug", "display_name", "bio", "x_url", "facebook_url", "ig_url", "tiktok_url", "email", "created_at", "updated_at", "broadcast_message", "image_url", "is_queue_open") VALUES
	('ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', 'test2', 'KongzasTest', 'testRLS', NULL, NULL, NULL, NULL, NULL, '2026-01-23 16:11:05.356959+00', '2026-01-23 16:13:42.430018+00', NULL, NULL, true),
	('b5bc17ad-e050-4f74-9205-5147ec350d83', 'test1', 'Genshin Impact Artist', 'Creating fan art and merch for travelers✨', 'https://twitter.com', 'https://www.facebook.com/kongzas/', 'https://instagram.com', 'https://www.tiktok.com/@kongzaswithpaimon', 'contact@artist.com', '2026-01-20 05:01:35+00', '2026-01-24 12:36:22.604103+00', NULL, 'https://ik.imagekit.io/kongzas/Avatar/b5bc17ad-e050-4f74-9205-5147ec350d83/1769258180589.webp?tr=w-400,h-400,fo-auto', true);


--
-- Data for Name: events; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."events" ("id", "artist_id", "event_name", "start_date", "end_date", "location_name", "location_detail", "transit_info", "booth_number", "entrance_fee", "status", "is_next_up", "created_at", "last_updated_at", "is_booth_open", "broadcast_message") VALUES
	('70baf484-1a59-4be7-97f1-376f0f8d82e1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'Comic Square 9', '2026-03-07 03:00:00+00', '2026-03-08 16:59:59+00', 'Union Hall 1-2', 'Union Mall, Bangkok', 'MRT Phahon Yothin (BL14)
BTS Ha Yaek Lat Phrao (N9)', 'A-1', '120 THB', 'Confirmed', true, '2026-01-21 04:29:45+00', '2026-01-21 08:01:25.342994+00', false, NULL),
	('94df637e-997e-4c97-81d5-1182040062d1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'TestRealtime', '2026-01-23 01:41:00+00', '2026-01-23 01:41:00+00', 'RT', 'RT', 'RT', 'R1', 'Free', 'Cancelled', false, '2026-01-22 18:26:44.965554+00', '2026-01-23 02:53:02.744353+00', true, NULL),
	('a73bb29d-0bdc-464b-9258-e9b75e4cabf4', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'Test1', '2026-01-01 18:30:00+00', '2026-01-01 18:30:00+00', 'TestHome', 'TestLocation', 'BUS 120', 'A123', '180 THB', 'Confirmed', false, '2026-01-21 07:42:43.736672+00', '2026-01-21 11:30:54.714434+00', true, NULL),
	('35ba053a-c91c-4a21-b034-d7e6a787bddb', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'Japan Expo Thailand 2026', '2026-01-21 18:30:00+00', '2026-01-21 18:30:00+00', 'CentralWorld', '', 'BTS Siam
BTS Chidlom', 'A2', 'Free', 'Cancelled', true, '2026-01-21 07:40:28.038232+00', '2026-01-21 11:51:29.036799+00', true, NULL),
	('c83c8190-2b27-4a1e-9770-dca04320064f', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'SameDayEvent', '2026-01-21 18:56:00+00', '2026-01-21 18:56:00+00', 'SameDay', 'SameDay', 'Same', 'SD1', '200', 'Confirmed', false, '2026-01-21 11:57:06.597926+00', '2026-01-21 11:57:26.537373+00', true, NULL),
	('004c3287-d384-4424-b499-e632266dfa51', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'RT2', '2026-01-23 17:05:00+00', '2026-01-23 17:05:00+00', 'RT2', 'RT2', 'RT2', 'R2', 'Free', 'Confirmed', false, '2026-01-23 02:28:52.053441+00', '2026-01-23 10:05:43.854928+00', true, NULL),
	('23030741-07ba-43fe-baba-f21756e6ed02', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', 'TestRSL', '2026-01-23 23:33:00+00', '2026-01-23 23:33:00+00', 'RLS', 'RLS', 'RLS', NULL, 'Free', 'Confirmed', false, '2026-01-23 16:33:59.074337+00', '2026-01-23 16:35:52.395105+00', true, NULL),
	('80652f5e-59c8-4723-9fd0-8440b41b4731', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'Newday', '2026-01-24 00:02:00+00', '2026-01-25 00:02:00+00', '2day', '2day', '2Day-Event Test', NULL, '180 THB', 'Confirmed', false, '2026-01-23 17:03:10.48543+00', '2026-01-23 17:03:10.48543+00', false, NULL);


--
-- Data for Name: artist_members; Type: TABLE DATA; Schema: public; Owner: postgres
--

-- Owner rows are seeded here because the migration that auto-seeds them
-- runs before seed.sql inserts artists, so the migration's INSERT finds no rows.
INSERT INTO "public"."artist_members" ("artist_id", "member_email", "role", "status", "created_by")
VALUES
	('b5bc17ad-e050-4f74-9205-5147ec350d83', 'konglnwzas@gmail.com', 'owner', 'active', 'b5bc17ad-e050-4f74-9205-5147ec350d83'),
	('ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', 'kongphop.sunit@gmail.com', 'owner', 'active', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe')
ON CONFLICT DO NOTHING;


--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."products" ("id", "artist_id", "name", "price", "description", "category", "image_url", "is_out_of_stock", "created_at", "updated_at", "status") VALUES
	('58bc585f-192a-4935-9296-323a55cb2ec5', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'Mini Figure Wondrous Travels', 1600, 'ตัวละ 1600 บาท ขนาด 11 - 14cm วัสดุ PVC ABS', 'Other', 'public/1769006991421-nr4ony5j1j.jpg', false, '2026-01-21 14:44:27.149539+00', '2026-01-21 14:49:53.642232+00', 'enable'),
	('3ad2a178-6340-4247-b56b-42864a26955f', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'Yoimiya Frolicking Flames Game Controller', 2800, 'Product Contents: Custom controller, custom joystick caps x2, charging dock, water-sound bell charm, data cable', 'Other', 'public/1769007007202-8skbu72jpse.jpg', false, '2026-01-21 14:44:27.149539+00', '2026-01-21 14:50:08.456904+00', 'enable'),
	('78f17195-0e01-40b0-906b-4ff7ef2e82d9', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'Paimon Chibi Plush Doll ', 2000, 'ขนาดตัวเมื่อยืนขึ้น 30cm วัสดุ Polycool Fiber 100%.', 'Doll', 'public/1769166544373-iyutt0fauq.jpg', false, '2026-01-20 07:43:17+00', '2026-01-23 11:09:05.804073+00', 'enable'),
	('9d3ffa82-0fbe-484b-83fe-f62f3e1ca689', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'Dress Furina Theme', 3000, '', 'A3', 'public/1769173254614-71v6955wmzy.webp', false, '2026-01-20 16:47:32.804851+00', '2026-01-23 13:00:56.15474+00', 'enable'),
	('5c55238b-6d78-4a81-86d0-2ce536e835c5', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'เข็มกลัดจิบิ Columbina', 130, 'ขนาด 5.8cm สุ่มมีลายปกติ 8 ลาย และ Secret 2 ลาย', 'Gacha', 'public/1769174158627-i8nbqpums0f.webp', false, '2026-01-23 11:36:47.058148+00', '2026-01-23 13:16:00.535868+00', 'enable'),
	('2057d04f-bdad-4e8e-991e-47ac02ffcdb4', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'ฉากประดับอะคริลิคพระจันทร์ใหม่', 600, 'ขนาด 16.5*17.1cm เรืองแสงในที่มืด', 'Standy', 'public/1769174174290-g90zitvg2um.jpg', false, '2026-01-23 11:36:47.058148+00', '2026-01-23 13:16:15.467087+00', 'enable'),
	('b21f0d66-bcec-40b9-a349-2397fd990b49', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 'Test Item', 10, 'Test1', 'ตุ๊กตา', 'public/1769174867584-5mlya84dxi4.webp', false, '2026-01-23 13:27:48.828753+00', '2026-01-23 13:28:17.935615+00', 'enable'),
	('95819ad9-32bd-495a-a937-935bb995500a', 'ffddfce5-26a4-4e57-8f3e-86ace5ef45fe', 'ItemRLS', 1, 'TestItemRLS', '', 'public/1769186119594-lb0um5r5oh.webp', false, '2026-01-23 16:35:21.01421+00', '2026-01-23 16:35:21.01421+00', 'enable');


--
-- Data for Name: queues; Type: TABLE DATA; Schema: public; Owner: postgres
--

-- Temporarily drop constraint so historical rows (dumped before queue_service_date was added)
-- can be inserted, then back-fill the column from created_at and restore the constraint.
ALTER TABLE public.queues DROP CONSTRAINT IF EXISTS queues_event_service_date_required_chk;

INSERT INTO "public"."queues" ("id", "artist_id", "queue_number", "status", "created_at", "last_updated_at", "event_id", "called_at", "completed_at", "served_at") VALUES
	('4ef79b83-b8f1-41c4-98e7-ddfa30354cff', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 1, 'expired', '2026-01-21 10:50:07.589913+00', '2026-01-21 13:21:03.875246+00', 'a73bb29d-0bdc-464b-9258-e9b75e4cabf4', NULL, NULL, NULL),
	('3fd56fc5-8509-4e11-bb54-dca42f23280b', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 2, 'expired', '2026-01-21 10:50:49.831511+00', '2026-01-21 13:21:03.875246+00', 'a73bb29d-0bdc-464b-9258-e9b75e4cabf4', NULL, NULL, NULL),
	('e03ae83b-1a32-4970-8e7f-dc12b2547372', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 1, 'expired', '2026-01-21 11:33:35.289461+00', '2026-01-21 13:21:03.875246+00', '35ba053a-c91c-4a21-b034-d7e6a787bddb', NULL, NULL, NULL),
	('573ca8ac-e54f-44b7-8e83-e9f021e01dda', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 2, 'expired', '2026-01-21 11:40:02.262422+00', '2026-01-21 13:21:03.875246+00', '35ba053a-c91c-4a21-b034-d7e6a787bddb', NULL, NULL, NULL),
	('5680f4ec-2b0d-4608-a7bd-f842ec9688ab', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 3, 'expired', '2026-01-21 11:28:44.183618+00', '2026-01-21 13:21:03.875246+00', 'a73bb29d-0bdc-464b-9258-e9b75e4cabf4', NULL, NULL, NULL),
	('20765bb7-1108-4d23-aed6-ff80035e54c1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 1, 'expired', '2026-01-21 11:58:09.736997+00', '2026-01-21 13:21:03.875246+00', 'c83c8190-2b27-4a1e-9770-dca04320064f', NULL, NULL, NULL),
	('f3a65df4-cab9-4046-8817-abbd1ac9af0e', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 2, 'expired', '2026-01-21 12:20:54.220524+00', '2026-01-21 13:21:03.875246+00', 'c83c8190-2b27-4a1e-9770-dca04320064f', NULL, NULL, NULL),
	('7d872ed1-b5d3-476a-8a0c-5e43aed147a3', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 3, 'expired', '2026-01-21 12:39:20.650589+00', '2026-01-21 13:21:03.875246+00', 'c83c8190-2b27-4a1e-9770-dca04320064f', NULL, NULL, NULL),
	('7d802275-aaa6-4864-b44b-db43c43c22f4', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 4, 'expired', '2026-01-21 13:02:45.633993+00', '2026-01-21 13:21:03.875246+00', 'c83c8190-2b27-4a1e-9770-dca04320064f', NULL, NULL, NULL),
	('1f23dd31-67ba-4974-b354-be36f48e98cf', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 5, 'missed', '2026-01-21 13:04:37.355466+00', '2026-01-21 13:24:56.210211+00', 'c83c8190-2b27-4a1e-9770-dca04320064f', NULL, NULL, NULL),
	('da40dc93-1d28-485d-b102-bf394bd523f2', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 24, 'missed', '2026-01-23 08:45:47.713075+00', '2026-01-23 08:46:18.615833+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('6bcb99f2-84ea-4f11-9b9b-d8c05c2aad8b', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 6, 'complete', '2026-01-21 13:10:47.573799+00', '2026-01-21 13:29:47.385073+00', 'c83c8190-2b27-4a1e-9770-dca04320064f', NULL, NULL, NULL),
	('17979263-6157-4e6c-80e9-ac56fe5278c0', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 16, 'complete', '2026-01-23 07:31:04.650609+00', '2026-01-23 14:56:50.407825+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, '2026-01-23 14:56:47.543+00'),
	('8d919e50-eda3-489e-98b2-4d8cd4268f31', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 1, 'complete', '2026-01-22 19:00:59.051535+00', '2026-01-22 19:01:38.338747+00', '94df637e-997e-4c97-81d5-1182040062d1', NULL, NULL, NULL),
	('a5215c53-472c-41b2-90b6-94e0775ec15e', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 2, 'missed', '2026-01-22 19:01:51.917023+00', '2026-01-22 19:05:48.26266+00', '94df637e-997e-4c97-81d5-1182040062d1', NULL, NULL, NULL),
	('7116552b-7f81-4113-be52-cde87c4e9832', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 3, 'missed', '2026-01-22 19:07:45.770896+00', '2026-01-22 19:07:56.525637+00', '94df637e-997e-4c97-81d5-1182040062d1', NULL, NULL, NULL),
	('c9c597ed-2cce-49e0-b622-b73265824996', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 4, 'missed', '2026-01-22 19:08:00.788006+00', '2026-01-22 19:08:13.451223+00', '94df637e-997e-4c97-81d5-1182040062d1', NULL, NULL, NULL),
	('636e52b6-fcd7-4f39-9c1b-d2da1ddaf15f', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 5, 'waiting', '2026-01-22 19:08:14.68086+00', '2026-01-22 19:08:14.68086+00', '94df637e-997e-4c97-81d5-1182040062d1', NULL, NULL, NULL),
	('18c88d20-a749-49ae-bade-4217fde11d2e', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 6, 'waiting', '2026-01-23 02:29:38.176+00', '2026-01-23 02:29:38.176+00', '94df637e-997e-4c97-81d5-1182040062d1', NULL, NULL, NULL),
	('704aa271-2813-4bbe-9d0f-bb60737d624f', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 13, 'missed', '2026-01-23 07:04:15.242071+00', '2026-01-23 07:12:27.895952+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('7d4cc4cc-5f0e-4e25-831f-9c14d0ee05d1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 5, 'missed', '2026-01-23 04:47:45.012125+00', '2026-01-23 05:00:28.486511+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('115aaa1c-58db-47f2-b79a-8c7e1b9049ef', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 6, 'missed', '2026-01-23 05:00:50.046636+00', '2026-01-23 05:07:08.194433+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('c99b6152-b3b5-4e81-b58d-26d6ff9ba253', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 25, 'expired', '2026-01-23 08:49:25.618997+00', '2026-01-23 08:55:49.660447+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('85472153-9b2e-45f1-bae2-1684de87e5ab', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 19, 'expired', '2026-01-23 07:53:03.305325+00', '2026-01-23 08:58:50.531062+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('c4f57470-1650-47c5-991b-9bef2b9277a1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 10, 'complete', '2026-01-23 06:31:49.732898+00', '2026-01-23 07:15:53.075665+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('3de93b51-38ee-4c38-8266-16a14105242f', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 14, 'missed', '2026-01-23 07:12:29.191647+00', '2026-01-23 07:15:59.639274+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('0814d653-2ee0-46e3-8cab-cf6ffd5713e0', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 21, 'complete', '2026-01-23 08:04:45.647191+00', '2026-01-23 14:57:22.903648+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, '2026-01-23 14:57:07.677+00'),
	('4e6251d8-fdf3-4402-ad91-8199a53095b0', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 3, 'expired', '2026-01-23 04:36:21.84129+00', '2026-01-23 05:16:16.931192+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('ff3695b0-2072-4fe7-ab7c-8af480b8bc8d', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 2, 'expired', '2026-01-23 04:29:54.315253+00', '2026-01-23 05:16:16.978132+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('8cd761da-5ff3-4c34-96cc-8315db2c35eb', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 4, 'expired', '2026-01-23 04:45:35.297143+00', '2026-01-23 05:16:16.993367+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('da8493da-1a2e-4ad5-9409-5c3a72986b35', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 7, 'missed', '2026-01-23 05:07:16.863262+00', '2026-01-23 05:18:31.014771+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('1f36f91f-8952-4905-9b5b-60146c4b611b', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 1, 'expired', '2026-01-23 02:39:27.418859+00', '2026-01-23 05:23:30.313668+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('eda1e326-07fa-476e-867e-ecf7f0c58dda', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 15, 'missed', '2026-01-23 07:16:09.711473+00', '2026-01-23 07:38:21.56048+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('e7836f65-d337-4f51-927a-a3b691cc0e04', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 8, 'expired', '2026-01-23 05:18:32.138294+00', '2026-01-23 05:54:35.886688+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('e0425348-b660-4042-a7e2-dd296ac10c7d', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 11, 'missed', '2026-01-23 06:40:30.73456+00', '2026-01-23 06:50:10.075369+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('83540180-ea73-4538-b977-3d10321d2ddd', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 9, 'missed', '2026-01-23 05:37:19.480479+00', '2026-01-23 06:54:19.491767+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('c0b8a325-7739-439e-8d6f-f038463b00cf', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 29, 'complete', '2026-01-23 14:55:44.419611+00', '2026-01-23 14:59:13.655147+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, '2026-01-23 14:57:45.158+00'),
	('0d3ead6a-2290-410b-b8d8-162d16360424', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 12, 'missed', '2026-01-23 06:54:30.339865+00', '2026-01-23 07:03:48.118995+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('3ab9b7e1-4e3f-4589-a79f-1e9f79667666', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 18, 'missed', '2026-01-23 07:44:18.475778+00', '2026-01-23 07:52:24.522961+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('9ab8edd2-57b6-49bd-bdaa-8634ccc621fa', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 20, 'missed', '2026-01-23 08:03:14.795899+00', '2026-01-23 08:03:55.287252+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('682da147-c881-46e4-844c-fe98e233795f', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 30, 'complete', '2026-01-23 14:58:31.114551+00', '2026-01-23 15:37:13.422571+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, '2026-01-23 15:37:13+00', '2026-01-23 15:35:57.719+00'),
	('063eba9f-d859-4e26-9431-0a92c3b65f6c', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 22, 'complete', '2026-01-23 08:18:56.4619+00', '2026-01-23 08:30:15.999253+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('3366183f-81c5-439b-a230-8e816d5050b7', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 26, 'missed', '2026-01-23 09:16:22.492022+00', '2026-01-23 09:30:00.706444+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('fc522a73-8937-4257-875e-70f51fdfa5aa', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 23, 'complete', '2026-01-23 08:44:08.305695+00', '2026-01-23 08:45:12.444786+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('6461ff52-5b89-4713-bba6-e8a2fbcb51b1', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 31, 'complete', '2026-01-23 15:37:53.379173+00', '2026-01-23 15:39:05.692285+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, '2026-01-23 15:39:05.315+00', '2026-01-23 15:38:39.417+00'),
	('126c6337-9c57-4397-ac26-d517d55e540f', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 28, 'missed', '2026-01-23 09:30:03.245939+00', '2026-01-23 10:03:06.123699+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('09786730-165a-43ea-9979-5e9b61683493', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 17, 'expired', '2026-01-23 07:38:39.699632+00', '2026-01-23 10:07:58.566342+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('f6df91f4-ee7e-4b33-8f61-84a383908168', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 27, 'complete', '2026-01-23 09:22:14.486137+00', '2026-01-23 14:56:28.151424+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL),
	('ffd57076-5a1f-4965-b18e-fba8693f3917', 'b5bc17ad-e050-4f74-9205-5147ec350d83', 32, 'expired', '2026-01-23 15:48:30.071026+00', '2026-01-23 16:19:34.874208+00', '004c3287-d384-4424-b499-e632266dfa51', NULL, NULL, NULL);

-- Back-fill queue_service_date for all rows that have an event_id (Bangkok timezone)
UPDATE public.queues
  SET queue_service_date = (created_at AT TIME ZONE 'Asia/Bangkok')::date
  WHERE event_id IS NOT NULL AND queue_service_date IS NULL;

-- Restore constraint
ALTER TABLE public.queues
  ADD CONSTRAINT queues_event_service_date_required_chk
  CHECK (event_id IS NULL OR queue_service_date IS NOT NULL);


--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 209, true);


--
-- Name: queues_queue_number_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."queues_queue_number_seq"', 1, false);


--
-- PostgreSQL database dump complete
--

-- \unrestrict NJf5fR35kvrfCUTYodj096ZqSfpuG0vINbGh0jceZOwuBP6QUHk2eI13rlaIOsJ

RESET ALL;
