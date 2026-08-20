# mitreden auf einem NAS oder einem anderen Rechner, der durchläuft.
#
# Das Abbild bringt nur die Laufzeit mit - Python, ffmpeg, Pillow. Das Projekt
# selbst wird als Verzeichnis hineingereicht, damit layout.json, symbols/ und
# cache/ auf dem NAS liegen und dort gesichert werden.

FROM python:3.12-slim

# ffmpeg schneidet die Stille und normalisiert die Lautheit.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8771
# Im Container muss auf allen Adressen gelauscht werden, sonst kommt die
# Portweiterleitung nicht durch. Nach außen begrenzt das die Portfreigabe.
CMD ["python", "app.py", "--host", "0.0.0.0"]
