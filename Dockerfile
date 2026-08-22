# vorlaut on a NAS or another machine that stays on.
#
# The image brings everything that runs: Python, ffmpeg, Pillow, the four
# piper voices - and the project's own code, so that the version that was
# pulled is the version that runs. Only what belongs to you is handed in from
# outside, as one directory at /data: layout.json, symbols/, cache/ and the
# .env with the Azure key. See docker-compose.yml.

FROM python:3.12-slim

# ffmpeg trims the silence and normalises the loudness.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# piper speaks without an account anywhere. It brings onnxruntime along and
# grows the image by roughly 200 MB - which is the whole price of a talker
# that needs no key.
#
# Pinned exactly, and more tightly than Pillow in requirements.txt, for a
# reason that is specific to this one: piper renders the audio, and nothing
# downstream can tell that it changed. A cached WAV is named by
# tts.fingerprint(), which covers the text, the model, the ffmpeg chain and
# PIPELINE_VERSION - but not the version of piper that spoke it. So a minor
# release that alters the output leaves every existing recording sitting in
# the cache under a name that says it is the same, next to new ones that are
# not. Nobody would hear it until two sentences on the same device sounded
# like two different people.
#
# The bound is therefore not about API breakage, which a ceiling at the next
# major would cover. It is that any change at all has to be a decision:
# bump this line, and re-render deliberately.
RUN pip install --no-cache-dir piper-tts==1.7.0

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# The user everything below runs as. Without it the container is root, and
# with /data bind-mounted from the NAS every file the app writes - the layout,
# the symbols, the spoken sentences - belongs to root over there too. Over a
# network share that means you cannot edit your own child's content without
# sudo, and the whole thing quietly stops being usable.
#
# 1000:1000 because that is the first id an ordinary Linux install hands out.
# A NAS numbers its people differently, and docker-compose.yml can be told so
# with VORLAUT_UID. Which is why nothing below may depend on this name or this
# number: the container is often run as an id that has no entry in /etc/passwd
# at all, and everything has to work anyway.
RUN groupadd --gid 1000 vorlaut \
 && useradd --uid 1000 --gid 1000 --no-log-init --create-home vorlaut \
 && mkdir /data \
 && chown vorlaut:vorlaut /data

# And /data is where the app looks, because the image says so rather than
# because a Compose file remembered to. These two lived in docker-compose.yml
# alone, which meant the image could not be run without it: config.py falls
# back to ROOT/content, that is /app/content, and /app belongs to root while
# the app does not. A plain "docker run" got as far as
#
#   PermissionError: [Errno 13] Permission denied: '/app/content'
#
# and stopped there - on an image whose whole point is that it carries
# everything it needs. Here they are part of what was pulled, so one
# "docker run -v vorlaut-data:/data" is a working server.
ENV VORLAUT_CONTENT=/data
# The .env with the Azure key and the licence belongs to you too, so it lives
# in /data with the rest. Deliberately not Compose's "env_file:": that injects
# values the container cannot write back, so every setting saved in the
# interface would be gone on the next recreate - and it would look like the
# save had silently failed.
ENV VORLAUT_ENV_FILE=/data/.env

# The four voices of the catalogue come along too, another 250 MB. Paying the
# 200 MB for onnxruntime above and then shipping a talker that cannot speak
# was the wrong half of both trades: a fresh container said "Nothing here can
# speak yet" until somebody found the Fetch voices button and waited out the
# download.
#
# They must not land under /app. docker-compose.build.yml mounts the source
# folder over it as ./:/app for developing, and that mount replaces the whole
# directory - anything baked into /app/voices is gone the moment such a
# container starts, and it looks exactly like the download never ran. /voices
# is outside the mount, and VORLAUT_VOICES is the first place tts.VOICE_DIRS
# looks.
#
# This does not close the door on the NAS. The search carries on into the
# content folder's voices/, so a fifth voice still drops in there, is still
# found, is still backed up with the rest of it - and still does not mean
# building the image again. What changed is only that the first four no longer
# have to be fetched by hand.
#
# Fetched with the project's own catalogue rather than a curl of its own, so
# that where a voice comes from is written down once. The cost is that the
# download runs again whenever one of the four files copied here changes.
ENV VORLAUT_VOICES=/voices
COPY config.py texts.py tts.py ./
COPY tools/voices.py tools/
# The download runs as root and the app does not, so what root's umask happens
# to have left behind is the difference between four voices and "nothing here
# can speak yet". Readable for everybody, and deliberately not a chown: the
# id this runs as is picked in docker-compose.yml and can be any id at all.
RUN python tools/voices.py \
 && chmod -R a+rX /voices

# Root-owned on purpose, and read-only to the app for it. The interface writes
# nothing here - everything that changes lives in /data - and an interface
# that anybody on the Wi-Fi can reach has no business being able to rewrite
# its own code.
COPY . .

# Which is also why nothing should try to drop a __pycache__ next to it.
# Python shrugs the failed write off, but it attempts one on every import and
# there is nothing to be had for it.
ENV PYTHONDONTWRITEBYTECODE=1

USER vorlaut

EXPOSE 8771
# UDP as well: that is where the device asks who has the content. Whether a
# broadcast reaches a container is a question for the network it is given -
# see docker-compose.yml.
EXPOSE 8771/udp

# "Started" is not "ready": the first run copies the example content into
# /data and seeds the speech cache before it answers anything. With this,
# "docker compose up -d --wait" returns when the interface really answers, and
# nothing needs a polling loop of its own.
#
# curl is not in python:3.12-slim and is not worth a layer for one request.
# Python is here anyway, and urlopen raises on anything that is not a 2xx -
# which is exactly the failed exit a healthcheck is asking for.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8771/', timeout=4)"]

# Inside a container it has to listen on every address, otherwise the port
# forwarding does not get through. Outwards the published port limits it.
CMD ["python", "app.py", "--host", "0.0.0.0"]
