import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRiderForm } from "../useRiderForm";
import SignaturePad from "../../../components/SignaturePad";
import { formatDateDDMMYYYY } from "../../../utils/dateFormat";

export default function Step3Agreement() {
  const { formData, updateForm } = useRiderForm();
  const navigate = useNavigate();

  const [attempted, setAttempted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const hasAcceptedRules = Boolean(formData.agreementConfirmInfo) && Boolean(formData.agreementAcceptTerms);

  useEffect(() => {
    if (!formData.agreementDate) {
      updateForm({ agreementDate: new Date().toISOString() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formattedDate = useMemo(() => {
    return formatDateDDMMYYYY(formData.agreementDate || new Date(), "-");
  }, [formData.agreementDate]);

  const isValid =
    Boolean(formData.agreementConfirmInfo) &&
    Boolean(formData.agreementAcceptTerms) &&
    Boolean(formData.riderSignature) &&
    Boolean(String(formData.issuedByName || "").trim());

  const goNext = () => {
    setAttempted(true);
    if (!isValid) return;
    updateForm({ agreementAccepted: true });
    navigate("../step-4");
  };

  return (
    <div className="space-y-6">

      <div className="card space-y-6 mx-auto w-full max-w-5xl">
        <header className="space-y-1">
          
          <h3 className="text-2xl font-semibold text-evegah-text">
            Acknowledgment &amp; Signature
          </h3>
          <p className="text-sm text-evegah-muted">
            Confirm the rider has read the rules, signed the agreement, and recorded the issuing staff name below.
          </p>
        </header>

        <section className="space-y-4 rounded-2xl border border-evegah-border bg-white/80 p-4 shadow-sm">
          <label className="flex items-start gap-2 text-sm text-evegah-text font-medium">
            <input
              type="checkbox"
              className="checkbox mt-0.5"
              checked={Boolean(formData.agreementConfirmInfo)}
              onChange={e => updateForm({ agreementConfirmInfo: e.target.checked })}
            />
            <span>
              I confirm all information above is true and correct. <span className="text-red-500">*</span>
            </span>
          </label>
          {attempted && !formData.agreementConfirmInfo ? (
            <p className="error">Please confirm the information is correct.</p>
          ) : null}

          <div>
            <label className="flex items-start gap-2 text-sm text-evegah-text font-medium">
              <input
                type="checkbox"
                className="checkbox mt-0.5"
                checked={Boolean(formData.agreementAcceptTerms)}
                readOnly
                disabled
              />
              <span>
                I have read &amp; understand the Evegah E-Bike Rental Agreement: Rules and Regulations, and I agree to return the Vehicle in good condition. <span className="text-red-500">*</span>
              </span>
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={`text-sm font-semibold ${hasAcceptedRules ? "text-emerald-600" : "text-red-600"} hover:underline`}
                onClick={() => setTermsOpen(true)}
              >
                View the rules &amp; regulations
              </button>
              <span className={`text-xs ${hasAcceptedRules ? "text-emerald-600" : "text-red-600"}`}>
                {hasAcceptedRules
                  ? "Rules accepted — thank you for confirming."
                  : "Please open the rules and tap Accept to continue."}
              </span>
            </div>
            {attempted && !hasAcceptedRules ? (
              <p className="error">Open the rules popup and tap Accept to continue.</p>
            ) : null}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-evegah-border bg-white p-5 shadow-lg">
          <label className="label">
            Rider Signature <span className="text-red-500">*</span>
          </label>

          <div className="max-w-2xl">
            <SignaturePad
              value={formData.riderSignature}
              height={120}
              onChange={(dataUrl) => updateForm({ riderSignature: dataUrl })}
            />
          </div>

         
          {attempted && !formData.riderSignature ? (
            <p className="error">Signature is required.</p>
          ) : null}
        </section>

        <div>
          <p className="label">Date</p>
          <p className="text-sm text-evegah-text">{formattedDate}</p>
        </div>

        <div>
          <label className="label">
            Issued by (Name) <span className="text-red-500">*</span>
          </label>
          <input
            className="input"
            placeholder="Enter your name"
            value={formData.issuedByName || ""}
            onChange={(e) => updateForm({ issuedByName: e.target.value })}
          />
          {attempted && !String(formData.issuedByName || "").trim() ? (
            <p className="error">Issued by name is required.</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-t border-evegah-border pt-4">
          <button type="button" className="btn-outline" onClick={() => navigate("../step-2")}>
            ← Back
          </button>
          <button
            type="button"
            className="btn-primary disabled:opacity-50"
            onClick={goNext}
            disabled={!isValid}
          >
            Next →
          </button>
        </div>
      </div>

      {termsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl rounded-2xl border border-evegah-border bg-white shadow-card">
            <div className="flex items-start justify-between gap-4 border-b border-evegah-border p-5">
              <div>
                <h3 className="text-base font-semibold text-evegah-text">
                  Evegah E-Bike Rental Agreement: Rules and Regulations
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Read the terms below and close this popup.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    updateForm({ agreementConfirmInfo: true, agreementAcceptTerms: true });
                    setTermsOpen(false);
                  }}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn-muted"
                  onClick={() => setTermsOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-5">
              <p className="text-sm text-gray-500 mb-4">
                At Evegah, we are committed to providing a safe, reliable, and environmentally friendly e-bike rental experience. By agreeing to this rental agreement, the Renter accepts the following terms and conditions:
              </p>

              <div className="space-y-3 text-sm text-evegah-text">
                <p>
                  <span className="font-medium">ID Documentation:</span> Renters must provide a valid government-issued ID, which will be photocopied for verification purposes. Evegah guarantees that IDs will be used solely for verification purposes. All personal data will be managed in strict compliance with applicable privacy laws and regulations.
                </p>
                <p>
                  <span className="font-medium">Usage Instructions:</span> Evegah will provide clear instructions on the proper use of the e-bike, including details on electric assist technology and battery charging procedures.
                </p>
                <p>
                  <span className="font-medium">Pre-Ride Inspection:</span> Renters are required to inspect the e-bike for any visible defects or issues before use and report them to Evegah immediately.
                </p>
                <p>
                  <span className="font-medium">General Care:</span> Renters are responsible for maintaining the e-bike in good condition to ensure it remains functional for the next user.
                </p>
                <p>
                  <span className="font-medium">Security and Safety:</span> Renters must secure the e-bike with a lock when not in use. The e-bike must not be used in hazardous environments, such as lakes, muddy trails, or unsafe terrains. In the event of theft, the Renter is responsible for reimbursing Evegah for the full value of the e-bike as per the current price list.
                </p>
                <p>
                  <span className="font-medium">E-bike Condition on Return:</span> E-bikes must be returned in the same technical condition as they were rented. Any defects or damages must be reported immediately to Evegah Customer Service/Helpline Number: 8980966376, 8980966343.
                </p>
                <p>
                  <span className="font-medium">Accessories:</span> Renters will be charged for the loss or damage of accessories based on current market prices.
                </p>
                <p>
                  <span className="font-medium">Damages and Liability:</span> Renters are liable for damages caused by improper use and will be charged accordingly. Renters are also responsible for any third-party damages resulting from their negligence.
                </p>
                <p>
                  <span className="font-medium">Personal Health and Safety:</span> Evegah does not provide personal health or accident insurance. Renters assume full responsibility for any injury, disability, or fatality resulting from e-bike use. Evegah will not be held liable for such incidents.
                </p>
                <p>
                  <span className="font-medium">Protection of Electric Components:</span> Renters must protect the e-bike's electric components, particularly during wet or extreme weather conditions.
                </p>
                <p>
                  <span className="font-medium">Late Return:</span> E-bikes returned more than one day after the agreed return time will result in the forfeiture of the security deposit.
                </p>
                <p>
                  <span className="font-medium">Subleasing:</span> Subleasing or re-renting the e-bike to another party is strictly prohibited.
                </p>
                <p>
                  <span className="font-medium">Single Rider Use:</span> E-bikes are designed for single riders only. Carrying passengers is not allowed.
                </p>
                <p>
                  <span className="font-medium">Smoking Prohibited:</span> Smoking is strictly forbidden while using the e-bike.
                </p>
                <p>
                  <span className="font-medium">Intoxication Prohibited:</span> Riding an e-bike under the influence of alcohol is strictly prohibited.
                </p>
                <p>
                  <span className="font-medium">Traffic Rules:</span> Rider must follow all traffic and safety rules while riding.
                </p>
                <p>
                  <span className="font-medium">Termination of Rental:</span> Company can terminate rental on misuse of eBike and rental pay.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
