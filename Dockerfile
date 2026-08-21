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
