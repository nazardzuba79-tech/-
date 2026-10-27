FROM voltex-demo-off:89c3ac003b44a6a0e7630d2ecbe5d7164e85b683
COPY dist/ /app/dist/
COPY probe.cjs desired-config.json /opt/eclv-peak/
RUN node /opt/eclv-peak/probe.cjs
