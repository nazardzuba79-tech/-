# This image is not built or run by the review-only source preparation.
# Build context must be the separately verified, allowlisted frozen closure.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG SOURCE_SHA
ARG CONTEXT_SHA256
LABEL org.opencontainers.image.revision=${SOURCE_SHA}
LABEL voltex.auth-http.context=${CONTEXT_SHA256}
WORKDIR /source
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . ./
USER 10001:10001
ENTRYPOINT ["node"]
CMD ["-e", "throw new Error('REVIEW_ONLY_NO_DEFAULT_ENTRY')"]
