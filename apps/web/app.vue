<script setup lang="ts">
import { useJsonLd } from '~/composables/useJsonLd';
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from '~/utils/seo-jsonld';

useJsonLd((origin) => [buildOrganizationJsonLd(origin), buildWebSiteJsonLd(origin)]);
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <AppToaster />
</template>
