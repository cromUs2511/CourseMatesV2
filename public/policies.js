const contact = document.querySelector('[data-support-contact]');
if (contact) {
  fetch('/api/public-config', { credentials: 'omit' })
    .then((response) => (response.ok ? response.json() : Promise.reject()))
    .then(({ supportEmail }) => {
      if (typeof supportEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail))
        return;
      const link = document.createElement('a');
      link.href = `mailto:${supportEmail}`;
      link.textContent = supportEmail;
      contact.replaceChildren(link);
    })
    .catch(() => {
      /* Keep the local-development contact explanation visible. */
    });
}
