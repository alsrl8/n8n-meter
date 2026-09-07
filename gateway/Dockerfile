FROM nginx:1.27-alpine
COPY gateway/default.conf.template /etc/nginx/templates/default.conf.template
COPY extension/workflow-bridge.js extension/workflow-usage.js extension/overlay.js /overlay/
ENV N8N_UPSTREAM=http://n8n:5678 N8N_METER_UPSTREAM=http://n8nmeter:7810
EXPOSE 8080
