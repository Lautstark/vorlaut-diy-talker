# vorlaut on a NAS or another machine that stays on.
#
# The image brings only the runtime - Python, ffmpeg, Pillow. The project
# itself is handed in as a directory, so that layout.json, symbols/ and cache/
# live on the NAS and are backed up there.

FROM python:3.12-slim

# ffmpeg trims the silence and normalises the loudness.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# piper speaks without an account anywhere. It brings onnxruntime along and
# grows the image by roughly 200 MB - which is the whole price of a talker
# that needs no key.
#
# The voices themselves are not in here. The project is handed in as a
# directory anyway, so they live in content/voices/ on the NAS, are backed up
# with the rest of the content, and a fifth voice does not mean building the
# image again. Fetch them once with:  python3 tools/voices.py
RUN pip install --no-cache-dir piper-tts

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8771
# UDP as well: that is where the device asks who has the content. Whether a
# broadcast reaches a container is a question for the network it is given -
# see docker-compose.yml.
EXPOSE 8771/udp
# Inside a container it has to listen on every address, otherwise the port
# forwarding does not get through. Outwards the published port limits it.
CMD ["python", "app.py", "--host", "0.0.0.0"]
