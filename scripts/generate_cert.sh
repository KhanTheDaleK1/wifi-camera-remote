#!/bin/bash
mkdir -p ../certs
openssl req -nodes -new -x509 -keyout ../certs/key.pem -out ../certs/cert.pem -days 365 -subj "/C=US/ST=State/L=City/O=Organization/OU=Unit/CN=localhost"
echo "Certificates generated in ../certs/"
