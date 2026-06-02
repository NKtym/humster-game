FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN go build -o /out/hamster-backend main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/hamster-backend /app/hamster-backend
EXPOSE 10000
CMD ["/app/hamster-backend"]