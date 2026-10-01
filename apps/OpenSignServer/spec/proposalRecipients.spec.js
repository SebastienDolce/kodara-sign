/* global describe, it, expect */

import {
  hashRecipientToken,
  proposalRecipientLabel,
  requestedProposalRecipients,
  resolveProposalRecipient,
} from '../cloud/customRoute/proposalRecipients.js';

describe('proposal recipient authorization', () => {
  it('normalizes and accepts two distinct proposal recipients', () => {
    const recipients = requestedProposalRecipients({
      recipients: [
        { name: ' Jane Client ', email: ' JANE@EXAMPLE.COM ' },
        { name: 'John Client', email: 'john@example.com' },
      ],
    });

    expect(recipients).toEqual([
      { name: 'Jane Client', email: 'jane@example.com' },
      { name: 'John Client', email: 'john@example.com' },
    ]);
  });

  it('rejects duplicate recipient email addresses', () => {
    expect(() =>
      requestedProposalRecipients({
        recipients: [
          { name: 'Jane', email: 'shared@example.com' },
          { name: 'John', email: 'SHARED@example.com' },
        ],
      })
    ).toThrowError(/different email addresses/);
  });

  it('keeps legacy one-recipient proposal links working without a recipient token', () => {
    const recipient = resolveProposalRecipient({
      RecipientName: 'Jane Client',
      RecipientEmail: 'jane@example.com',
      ContactBookId: 'contact-1',
    });

    expect(recipient.email).toBe('jane@example.com');
    expect(recipient.contactBookId).toBe('contact-1');
  });

  it('requires and resolves the recipient-specific token for two-recipient proposals', () => {
    const janeToken = 'jane-secret-token';
    const johnToken = 'john-secret-token';
    const proposal = {
      AuthorizedRecipients: [
        {
          name: 'Jane Client',
          email: 'jane@example.com',
          contactBookId: 'contact-1',
          tokenHash: hashRecipientToken(janeToken),
        },
        {
          name: 'John Client',
          email: 'john@example.com',
          contactBookId: 'contact-2',
          tokenHash: hashRecipientToken(johnToken),
        },
      ],
    };

    expect(() => resolveProposalRecipient(proposal)).toThrowError(/missing its recipient authorization token/);
    expect(resolveProposalRecipient(proposal, johnToken).name).toBe('John Client');
    expect(() => resolveProposalRecipient(proposal, 'wrong-token')).toThrowError(/not authorized/);
    expect(proposalRecipientLabel(proposal)).toBe('Jane Client or John Client');
  });
});
