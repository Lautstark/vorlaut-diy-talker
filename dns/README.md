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

## The domain is delegated, and there is a mailbox

Settled since this was first written. As of **2026-08-28** `lautstark.tech`
resolves, and its nameservers are STRATO's:

```
shades20.rzone.de.
docks02.rzone.de.
```

A mailbox has been ordered on it, and **`steffi@lautstark.tech` is the public
address of the project** — the one in the Impressum and the privacy notice of
every Lautstark app. That is a change of purpose for this zone, not just a
change of records: it was written for a domain that would never send or
receive mail, and the mail block has been rewritten accordingly.

Ordering the mailbox set two things in the panel by itself — the `MX`, and
STRATO's DKIM selectors — and removed the null MX and the `v=spf1 -all` that
were there before. **One record still has to be typed in by hand:** the SPF
above is in the file and not in the panel, so the domain currently sends with
no SPF at all. See *Applying it* below; `verify.py` reports it as missing
until it is there.

## Applying it

1. Log in at <https://www.strato.de/apps/CustomerService>.
2. **Domains** → `lautstark.tech` → **DNS-Einstellungen** (DNS settings).
3. Add the **SPF record**, which is the one thing in the mail block that is not
   live yet. Record type TXT, name `@` (or blank, depending on the form),
   value — without the quotes:
   ```
   v=spf1 include:spf.rzone.de -all
   ```
4. Save, wait for the TTL, and run `python3 dns/verify.py`.

That is the whole of the outstanding work. The rest of the mail block is
already live because the mailbox order put it there, and is written down so
that a later change to the panel shows up as a diff rather than as a surprise:

| In the file | In the panel | State |
|---|---|---|
| `@ IN MX 5 smtpin.rzone.de.` | Record type MX, priority `5`, target `smtpin.rzone.de.` | live, set by the mailbox order |
| `@ IN TXT "v=spf1 include:spf.rzone.de -all"` | Record type TXT (sometimes labelled SPF), value without the quotes | **not live — step 3** |
| `_dmarc IN TXT "v=DMARC1;p=reject;"` | Record type TXT, name `_dmarc`, value without the quotes | live, set by the mailbox order |
| `strato-dkim-000N._domainkey` | STRATO's, not transcribed | live, rotates without notice |

Do not add the SPF as a record type literally called "SPF" if the form offers
both — the standalone SPF type is deprecated and receivers do not read it. It
is a TXT record.

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

## Why the mail records still come first

They did when there was no mail, and they do now that there is — for the same
reason, which is that a domain naming a project about disabled children is a
more attractive `From:` address to a certain kind of sender than most.

What changed is only which records say so. The old set refused everything:
`MX 0 .` accepted no mail, `v=spf1 -all` authorised no sender, and an empty
DKIM key made every signature invalid. That is the right posture for a domain
that will never send, and the wrong one the moment an Impressum points at an
address on it — a legally required contact that bounces is worse than no
domain at all.

The replacement is narrower rather than weaker: STRATO's hosts may send, by
`include:`, and nobody else may. `p=reject` still says what to do when someone
tries. The one gap is that the SPF record is not in the panel yet, so today
the answer to "may this host send as lautstark.tech?" is *no policy at all*
rather than *no*. That is the weakest this domain has ever been against
forgery, and it closes with one TXT record — see *Applying it*.
