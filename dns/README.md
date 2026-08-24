# lautstark.tech

[`lautstark.tech.zone`](lautstark.tech.zone) is the record set. It is the
source of truth; STRATO's control panel is a copy of it, made by hand, and
[`verify.py`](verify.py) is what says whether the copy still matches.

```bash
python3 dns/verify.py
```

## Why this is a zone file and not Terraform

Because STRATO has no API.

That is the whole of it, and it is worth stating plainly rather than leaving
somebody to discover it: there is no official STRATO DNS API, no Terraform
provider, and no export format the panel will give you. The DNS records for a
STRATO domain are edited in a web form by a human being, and there is no
supported way to do it any other way.

There are community tools — `strato-dns-api` and similar — and they work by
logging into the STRATO customer account and submitting that form. Using one
from CI would mean putting the password for the account that holds the domain
into a repository secret, where it would also be the password that can transfer
the domain away. That is a bad trade for the convenience of not typing eight
records once, and it is not done here.

So "as code" means what it can honestly mean at this registrar:

- the records live in a file, in git, with reasons written next to them;
- changes to them are reviewed as diffs, like everything else;
- a script says when the live zone and the file have drifted apart.

What is missing compared to a real `terraform apply` is only the *applying*.
Everything else — review, history, blame, a single place to look — is here.

If that stops being an acceptable trade, the escape hatch is to
[delegate the zone](#if-typing-it-in-becomes-a-burden) to a host that has an
API, keeping the domain registered where it is.

## Before anything: the domain is not delegated yet

As of **2026-08-24**, `lautstark.tech` does not resolve, has no NS records, and
`whois` at the `.tech` registry reports it as available. A freshly bought
domain can lag its registry entry by a few hours, so this is most likely just
that — but until it clears, **nothing typed into any panel can take effect.**

`verify.py` checks this first and says so in one line, rather than reporting
every record as broken for the same single reason:

```bash
python3 dns/verify.py
```

> `lautstark.tech has no NS records: the domain is not in the registry yet, or
> is registered and not delegated.`

When that line goes away and a set of nameservers appears instead, check that
they are STRATO's. If the domain was bought at STRATO they will be, and they
look like `ns-strato.ui-dns.com` / `.de` / `.org` / `.biz`, or on older
accounts `docks01.rzone.de` and friends. If they are somebody else's, the
panel you are typing into is not the one serving the zone, and the records
will appear to do nothing.

## Applying it

1. Log in at <https://www.strato.de/apps/CustomerService>.
2. **Domains** → `lautstark.tech` → **DNS-Einstellungen** (DNS settings).
3. Type in the records from the **mail block** of the zone file — the four at
   the top. Not the Pages block; see below.
4. Save, wait for the TTL, and run `python3 dns/verify.py`.

Notes on the four mail records, because STRATO's form is not a zone file:

| In the file | In the panel |
|---|---|
| `@ IN MX 0 .` | Record type MX, priority `0`, target `.` |
| `@ IN TXT "v=spf1 -all"` | Record type TXT (sometimes labelled SPF), value without the quotes |
| `_dmarc IN TXT "…"` | Record type TXT, name `_dmarc`, value without the quotes |
| `*._domainkey IN TXT "v=DKIM1; p="` | Record type TXT, name `*._domainkey` |

**If the panel refuses a record**, the two likely candidates are the null MX
(some panels will not accept `.` as a mail target) and CAA (not every panel
offers the type at all). Do not work around it by inventing a substitute —
leave the record out, add a line to the zone file saying the panel refused it
and on what date, and treat that as one more argument for delegating. A zone
file that claims a record which is not there is worse than one that admits it.

**Do not add records in the panel that are not in this file.** If you need one
in a hurry, add it here in the same sitting; `verify.py` cannot tell you about
a record it has never heard of, and only checks that what the file describes is
live.

## Before the Pages records

The second half of the zone file is commented with a banner saying it is not
ready. Two things have to be true first, and neither is true today:

**1. There is no organisation site.** `Lautstark/Lautstark.github.io` does not
exist. The apex `A` and `AAAA` records point at GitHub's Pages addresses, and
those only serve `lautstark.tech` once a repository claims the domain — via a
`CNAME` file and **Settings → Pages → Custom domain**. Until then the records
resolve to GitHub and GitHub serves a 404.

**2. It moves every published URL, not just the apex.** Setting a custom domain
on the *organisation* site moves the project sites with it. The builder becomes

```
https://lautstark.tech/vorlaut-diy-talker/
```

rather than `https://lautstark.github.io/vorlaut-diy-talker/`. The old address
keeps working only for as long as GitHub keeps redirecting it, and the new one
has to be written back into `README.md`, `src/core/boot_data.ts` and the base
path in `package.json` and `playwright.config.ts` — the same set the repository
rename touched. That is a decision about published URLs, not a DNS change.

When both are settled, apply the Pages block and verify it with:

```bash
python3 dns/verify.py --pages
```

Leave the apex TTL at 3600 but consider dropping it to 300 in the panel for the
day of the switch, and putting it back afterwards.

## When the file and the live zone disagree

`verify.py` cannot tell which of the two is right, and does not guess. It
prints what it wanted and what it found, and the rule is:

- **The file is right, the panel drifted** → fix the panel. This is the usual
  case, and it means somebody changed DNS without writing it down.
- **The panel is right, the file drifted** → fix the file *and say why in the
  comment*. A record with no reason next to it is one nobody will dare delete.

## If typing it in becomes a burden

The escape hatch is to stop using STRATO as the DNS host while keeping the
domain registered there. Point the domain's nameservers at a provider with an
API — deSEC (free, EU, non-profit, has a Terraform provider) and Cloudflare are
both fine — and this file becomes something you can actually apply:

```bash
# deSEC, for example: the zone file imports directly
curl -X POST https://desec.io/api/v1/domains/lautstark.tech/rrsets/ …
```

`lautstark.tech.zone` is written as ordinary RFC 1035 with that in mind: no
provider-specific syntax, and `$ORIGIN` and `$TTL` where an importer expects
them. The SOA and NS records are deliberately absent, because they belong to
whoever is authoritative and writing our own would be writing down a guess.

This is worth doing the first time a record has to change under time pressure.
It is not worth doing for eight records that are set once and then left alone.

## Why a domain with no website still gets mail records first

The four records in the mail block do not depend on the website existing, and
they are the reason not to leave a newly registered domain empty. A domain with
no SPF and no DMARC is a usable `From:` address for anybody who wants one, and
this one names a project about disabled children — which makes it a more useful
address to a certain kind of sender than most.

`MX 0 .` says no mail is accepted, `v=spf1 -all` says no host may send as this
domain, `p=reject` says what to do when one tries, and the empty DKIM key says
no signature is valid. None of that needs a site to point at.
