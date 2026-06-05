FROM golang:1.22-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/hamster-backend .

FROM alpine:3.20
WORKDIR /app
RUN apk add --no-cache ca-certificates postgresql16-client
COPY --from=build /out/hamster-backend /usr/local/bin/hamster-backend
ENV PORT=8080
EXPOSE 8080
CMD ["hamster-backend"]