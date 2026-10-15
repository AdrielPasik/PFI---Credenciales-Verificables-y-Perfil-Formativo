# Pin to the reviewed linux/amd64 busybox 1.36.1 manifest, not a mutable tag.
FROM public.ecr.aws/docker/library/busybox@sha256:b7f3d86d6e84fc17718c48bcde1450807faa2d56704205c697b4bd5df7b9e29f

COPY --chmod=0555 entrypoint.sh /probe/entrypoint.sh
USER 65532:65532
ENTRYPOINT ["/probe/entrypoint.sh"]
CMD ["exit-zero"]
