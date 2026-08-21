# vorlaut on a NAS or another machine that stays on.
#
# The image brings the runtime - Python, ffmpeg, Pillow - and the four piper
# voices, so that it can speak the moment it starts. The project itself is
# handed in as a directory, so that layout.json, symbols/ and cache/ live on
# the NAS and are backed up there.

FROM python:3.12-slim

# ffmpeg trims the silence and normalises the loudness.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# piper speaks without an account anywhere. It brings onnxruntime along and
# grows the image by roughly 200 MB - which is the whole price of a talker
# that needs no key.
RUN pip install --no-cache-dir piper-tts

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# The four voices of the catalogue come along too, another 250 MB. Paying the
# 200 MB for onnxruntime above and then shipping a talker that cannot speak
# was the wrong half of both trades: a fresh container said "Nothing here can
# speak yet" until somebody found the Fetch voices button and waited out the
# download.
#
# They must not land under /app. docker-compose.yml mounts the project over
# it as ./:/app, and that mount replaces the whole directory at runtime -
# anything baked into /app/voices is gone the moment the container starts,
# and it looks exactly like the download never ran. /voices is outside the
# mount, and VORLAUT_VOICES is the first place tts.VOICE_DIRS looks.
#
# This does not close the door on the NAS. The search carries on into
# content/voices/ and voices/, so a fifth voice still drops into the content
# folder, is still found, is still backed up with the rest of it - and still
# does not mean building the image again. What changed is only that the
# first four no longer have to be fetched by hand.
#
# Fetched with the project's own catalogue rather than a curl of its own, so
# that where a voice comes from is written down once. The cost is that the
# download runs again whenever one of the four files copied here changes.
ENV VORLAUT_VOICES=/voices
COPY config.py texts.py tts.py ./
COPY tools/voices.py tools/
RUN python tools/voices.py

COPY . .

EXPOSE 8771
# UDP as well: that is where the device asks who has the content. Whether a
# broadcast reaches a container is a question for the network it is given -
# see docker-compose.yml.
EXPOSE 8771/udp
# Inside a container it has to listen on every address, otherwise the port
# forwarding does not get through. Outwards the published port limits it.
CMD ["python", "app.py", "--host", "0.0.0.0"]
