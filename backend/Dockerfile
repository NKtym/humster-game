FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN go build -o /out/hamster-backend main.go

FROM alpine:3.20
WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY --from=build /out/hamster-backend /usr/local/bin/hamster-backend
ENV PORT=8080
EXPOSE 8080
CMD ["hamster-backend"]