import { buildProposalViewNotification } from '../cloud/customRoute/proposalViewNotifications.js';

describe('proposal view notifications', () => {
  it('describes a link-open event without claiming recipient identity or acceptance', () => {
    const notification = buildProposalViewNotification(
      {
        Name: 'Ashley Hamilton Phase 1',
        ProposalNumber: 'KOD-2026-ABC123',
        RecipientName: 'Ashley Hamilton',
      },
      '2026-09-11T18:47:00.000Z'
    );

    expect(notification.subject).toBe('Proposal link opened: Ashley Hamilton Phase 1');
    expect(notification.text).toContain('Ashley Hamilton');
    expect(notification.text).toContain('does not prove who opened the link');
    expect(notification.text).toContain('not an acceptance or signature');
  });

  it('escapes proposal values before rendering notification HTML', () => {
    const notification = buildProposalViewNotification(
      {
        Name: '<script>alert(1)</script>',
        ProposalNumber: 'KOD-<1>',
        RecipientName: '<b>Ashley</b>',
      },
      '2026-09-11T18:47:00.000Z'
    );

    expect(notification.html).not.toContain('<script>alert(1)</script>');
    expect(notification.html).not.toContain('<b>Ashley</b>');
    expect(notification.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(notification.html).toContain('&lt;b&gt;Ashley&lt;/b&gt;');
  });
});
