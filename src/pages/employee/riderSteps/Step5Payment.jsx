import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { useRiderForm } from "../useRiderForm";
import { apiFetch, getPublicConfig } from "../../../config/api";
import { downloadRiderReceiptPdf } from "../../../utils/riderReceiptPdf";
import useAuth from "../../../hooks/useAuth";

export default function Step5Payment() {
  const { formData, resetForm } = useRiderForm();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [registration, setRegistration] = useState(null);
  const [formSnapshot, setFormSnapshot] = useState(null);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [whatsAppStatus, setWhatsAppStatus] = useState("");
  const [whatsAppFallback, setWhatsAppFallback] = useState(null);

  const [publicConfig, setPublicConfig] = useState({ upiId: null, payeeName: "Evegah" });
  useEffect(() => {
    getPublicConfig().then(setPublicConfig);
  }, []);

  const configuredUpiId = import.meta.env.VITE_EVEGAH_UPI_ID || publicConfig.upiId;
  const defaultUpiId = "temp.evegah@okaxis";
  const payeeName = import.meta.env.VITE_EVEGAH_PAYEE_NAME || publicConfig.payeeName || "Evegah";
  const iciciEnabled = import.meta.env.VITE_ICICI_ENABLED === "true";

  const amount = Number(formData.totalAmount || 0);
  const cashAmount = Number(formData.cashAmount || 0);
  const onlineAmount = Number(formData.onlineAmount || 0);
  const totalPaid = cashAmount + onlineAmount;
  const paymentMode = formData.paymentMode || "cash";
  const paymentModeLabel = paymentMode === "split"
    ? "Split (Cash + Online)"
    : `${paymentMode.charAt(0).toUpperCase()}${paymentMode.slice(1)}`;

  // For QR generation: use onlineAmount for split mode, total amount for online mode
  const qrAmount = paymentMode === "split" ? onlineAmount : (paymentMode === "online" ? amount : 0);
  const shouldShowQR = paymentMode === "online" || (paymentMode === "split" && onlineAmount > 0);

  const [iciciQrData, setIciciQrData] = useState(null);
  const [iciciQrLoading, setIciciQrLoading] = useState(false);
  const [iciciQrError, setIciciQrError] = useState("");

  const prepareDocumentForSubmission = (value) => {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      if (value.upload) return value.upload;
      if (value.url && value.file_name && value.mime_type) {
        return {
          url: value.url,
          file_name: value.file_name,
          mime_type: value.mime_type,
          size_bytes: Number(value.size_bytes ?? 0),
        };
      }
      if (value.dataUrl) {
        const next = { dataUrl: value.dataUrl };
        if (value.name) next.name = value.name;
        return next;
      }
    }
    return null;
  };

  const effectiveUpiId = configuredUpiId || defaultUpiId;
  const upiPayload = useMemo(() => {
    if (!effectiveUpiId || !shouldShowQR || !qrAmount) return "";
    const params = new URLSearchParams({
      pa: effectiveUpiId,
      pn: payeeName,
      am: String(qrAmount),
      cu: "INR",
    });
    return `upi://pay?${params.toString()}`;
  }, [effectiveUpiId, payeeName, qrAmount, shouldShowQR]);

  // Generate ICICI QR when ICICI is enabled and QR should be shown.
  useEffect(() => {
    if (!iciciEnabled || !shouldShowQR || !qrAmount || !formData.name) {
      setIciciQrData(null);
      setIciciQrError("");
      return;
    }

    let cancelled = false;

    const generateQr = async () => {
      setIciciQrLoading(true);
      setIciciQrError("");
      try {
        const response = await apiFetch("/api/payments/icici/qr", {
          method: "POST",
          body: {
            amount: qrAmount,
            // ICICI expects merchantTranId + billNumber in the encrypted payload.
            merchantTranId: `EVG${Date.now()}${Math.random().toString(16).slice(2, 6)}`.slice(0, 35),
            billNumber: `EVG-${Date.now()}`.slice(0, 50),
          },
        });
        if (!cancelled) setIciciQrData(response);
      } catch (error) {
        console.error("ICICI QR generation failed:", error);
        if (!cancelled) setIciciQrError(String(error?.message || error));
      } finally {
        if (!cancelled) setIciciQrLoading(false);
      }
    };

    generateQr();
    return () => {
      cancelled = true;
    };
  }, [iciciEnabled, shouldShowQR, qrAmount, formData.name]);

  const buildReceiptPayload = (snapshot) => ({
    fullName: snapshot?.fullName || snapshot?.name || "",
    name: snapshot?.name || snapshot?.fullName || "",
    phone: snapshot?.phone || "",
    mobile: snapshot?.mobile || snapshot?.phone || "",

    // Rider profile
    aadhaar: snapshot?.aadhaar || "",
    dob: snapshot?.dob || null,
    gender: snapshot?.gender || "",
    reference: snapshot?.reference || "",
    permanentAddress: snapshot?.permanentAddress || "",
    temporaryAddress: snapshot?.temporaryAddress || "",

    // Rider / agreement (optional)
    operationalZone: snapshot?.operationalZone || snapshot?.zone || "",
    agreementAccepted: Boolean(snapshot?.agreementAccepted),
    agreementDate: snapshot?.agreementDate || null,
    issuedByName: snapshot?.issuedByName || null,

    // Rental
    rentalStart: snapshot?.rentalStart || null,
    rentalEnd: snapshot?.rentalEnd || null,
    rentalPackage: snapshot?.rentalPackage || null,
    bikeModel: snapshot?.bikeModel || null,
    bikeId: snapshot?.bikeId || null,
    batteryId: snapshot?.batteryId || null,
    vehicleNumber: snapshot?.vehicleNumber || snapshot?.bikeId || null,
    accessories: Array.isArray(snapshot?.accessories) ? snapshot.accessories : [],
    otherAccessories: snapshot?.otherAccessories || null,

    // Payment
    paymentMode: snapshot?.paymentMode || null,
    rentalAmount: snapshot?.rentalAmount ?? null,
    securityDeposit: snapshot?.securityDeposit ?? null,
    totalAmount: snapshot?.totalAmount ?? null,
    amountPaid: snapshot?.amountPaid ?? snapshot?.paidAmount ?? snapshot?.totalAmount ?? null,

    // Signature only (small). Photos intentionally excluded.
    riderSignature: typeof snapshot?.riderSignature === "string" ? snapshot.riderSignature : null,
  });

  const handleSubmit = async () => {
    setSubmitError("");
    setWhatsAppStatus("");

    if (totalPaid !== amount) {
      setSubmitError("Cash + online payment totals must equal the total amount.");
      return;
    }

    const riderPhotoPayload = prepareDocumentForSubmission(formData.riderPhoto);
    const governmentIdPayload = prepareDocumentForSubmission(formData.governmentId);
    const preRidePayloads = (
      Array.isArray(formData.preRidePhotos) ? formData.preRidePhotos : []
    )
      .map(prepareDocumentForSubmission)
      .filter(Boolean);

    const fullName = String(formData.name || "").trim();
    const phoneDigits = String(formData.phone || "").replace(/\D/g, "").slice(0, 10);
    const aadhaarDigits = String(formData.aadhaar || "").replace(/\D/g, "").slice(0, 12);

    if (!fullName) {
      setSubmitError("Rider name is required.");
      return;
    }
    if (phoneDigits.length !== 10) {
      setSubmitError("Valid 10-digit mobile number is required.");
      return;
    }
    if (!formData.rentalStart) {
      setSubmitError("Rental start date & time is required.");
      return;
    }
    setSubmitting(true);
    try {
      const snapshot =
        typeof structuredClone === "function"
          ? structuredClone(formData)
          : JSON.parse(JSON.stringify(formData));

      const startIso = new Date(formData.rentalStart).toISOString();
      const endIso = formData.rentalEnd ? new Date(formData.rentalEnd).toISOString() : null;

      const vehicleNumber =
        String(formData.vehicleNumber || formData.bikeId || "").trim() || null;

      const registration = await apiFetch("/api/registrations/new-rider", {
        method: "POST",
        body: {
          rider: {
            full_name: fullName,
            mobile: phoneDigits,
            aadhaar: aadhaarDigits || null,
            dob: formData.dob ? String(formData.dob).slice(0, 10) : null,
            gender: formData.gender || null,
            permanent_address: formData.permanentAddress || null,
            temporary_address: formData.temporaryAddress || null,
            reference: formData.reference || null,
            meta: {
              aadhaar_verified: Boolean(formData.aadhaarVerified),
              aadhaar_verification_method: formData.aadhaarVerified ? "otp" : null,
            },
          },
          rental: {
            start_time: startIso,
            end_time: endIso,
            rental_package: formData.rentalPackage || null,
            rental_amount: Number(formData.rentalAmount || 0),
            deposit_amount: Number(formData.securityDeposit || 0),
            total_amount: Number(formData.totalAmount || 0),
            payment_mode: String(formData.paymentMode || "").trim() || null,
            bike_model: formData.bikeModel || null,
            bike_id: formData.bikeId || null,
            battery_id: formData.batteryId || null,
            vehicle_number: vehicleNumber,
            accessories: Array.isArray(formData.accessories) ? formData.accessories : [],
            other_accessories: formData.otherAccessories || null,
            meta: {
              zone: formData.operationalZone || null,
              agreement_accepted: Boolean(formData.agreementAccepted),
              agreement_confirm_info: Boolean(formData.agreementConfirmInfo),
              agreement_accept_terms: Boolean(formData.agreementAcceptTerms),
              agreement_date: formData.agreementDate || null,
              issued_by_name: formData.issuedByName || null,
              employee_uid: user?.uid || null,
              employee_email: user?.email || null,
              paymentBreakdown: {
                cash: cashAmount,
                online: onlineAmount,
              },
            },
          },
          documents: {
            riderPhoto: riderPhotoPayload,
            governmentId: governmentIdPayload,
            preRidePhotos: preRidePayloads,
            riderSignature: formData.riderSignature || null,
          },
        },
      });

      setRegistration(registration);
      setFormSnapshot(snapshot);
      setCompleted(true);
    } catch (e) {
      setSubmitError(String(e?.message || e || "Unable to complete registration"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadReceipt = async () => {
    setWhatsAppStatus("");
    setWhatsAppFallback(null);
    try {
      const snapshot = formSnapshot || formData;
      await downloadRiderReceiptPdf({ formData: buildReceiptPayload(snapshot), registration });
    } catch (e) {
      setWhatsAppStatus(
        e?.message ? `Unable to generate receipt: ${e.message}` : "Unable to generate receipt."
      );
    }
  };

  const handleSendWhatsApp = async () => {
    setWhatsAppStatus("");
    setWhatsAppFallback(null);
    const snapshot = formSnapshot || formData;
    const phoneDigits = String(snapshot?.phone || "")
      .replace(/\D/g, "")
      .slice(0, 10);
    if (phoneDigits.length !== 10) {
      setWhatsAppStatus("Valid 10-digit mobile number is required.");
      return;
    }

    // IMPORTANT: don't send large base64 images (photos) to the API.
    // It can easily exceed proxy limits and isn't required for the receipt PDF.
    const receiptPayload = buildReceiptPayload(snapshot);

    setSendingWhatsApp(true);
    try {
      const res = await apiFetch("/api/whatsapp/send-receipt", {
        method: "POST",
        body: {
          to: phoneDigits,
          formData: receiptPayload,
          registration,
        },
      });

      if (res?.sent) {
        setWhatsAppStatus("Receipt sent on WhatsApp.");
      } else if (res?.mediaUrl) {
        // Do not auto-open WhatsApp; prefer Cloud API template.
        // Provide an explicit button for staff to send manually if needed.
        setWhatsAppFallback({ phoneDigits, mediaUrl: res.mediaUrl });
        setWhatsAppStatus(String(res?.reason || res?.error || "Unable to send via WhatsApp Cloud API."));
      } else {
        setWhatsAppStatus(String(res?.reason || res?.error || "Unable to send receipt on WhatsApp."));
      }
    } catch (e) {
      setWhatsAppStatus(String(e?.message || e || "Unable to send on WhatsApp"));
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const handleNewRegistration = () => {
    setCompleted(false);
    setRegistration(null);
    setFormSnapshot(null);
    setWhatsAppStatus("");
    setWhatsAppFallback(null);
    resetForm();
    navigate("/employee/new-rider/step-1", { replace: true });
  };

  const openManualWhatsApp = () => {
    if (!whatsAppFallback?.phoneDigits || !whatsAppFallback?.mediaUrl) return;
    const text = encodeURIComponent(`EVegah Receipt (PDF): ${whatsAppFallback.mediaUrl}`);
    window.open(`https://wa.me/91${whatsAppFallback.phoneDigits}?text=${text}`, "_self");
  };

  return (
    <div className="card space-y-6 mx-auto w-full max-w-5xl">
      <div>
        <h3 className="text-base font-semibold text-evegah-text">Payment</h3>
        <p className="text-sm text-gray-500">
          Collect payment and print the form if needed.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="rounded-xl border border-evegah-border bg-gray-50 p-4 space-y-3">
            <h4 className="font-medium text-evegah-text">Payment QR</h4>

            {shouldShowQR ? (
              <>
                <p className="text-sm text-gray-500">
                  {paymentMode === "split"
                    ? `Scan to pay ₹${onlineAmount} via UPI (remaining ₹${cashAmount} in cash).`
                    : "Scan to pay via UPI."}
                </p>

                {iciciEnabled ? (
                  <>
                    {iciciQrLoading && (
                      <div className="flex items-center justify-center p-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-evegah-primary"></div>
                        <span className="ml-2 text-sm text-gray-500">Generating QR...</span>
                      </div>
                    )}
                    {iciciQrError && (
                      <p className="text-sm text-red-600">
                        ICICI QR generation failed: {iciciQrError}
                      </p>
                    )}
                    {iciciQrData?.qrCode && (
                      <div className="rounded-xl border border-evegah-border bg-white p-4 inline-flex">
                        {iciciQrData.qrCode.startsWith('data:') || iciciQrData.qrCode.startsWith('http') ? (
                          <img src={iciciQrData.qrCode} alt="ICICI Payment QR" className="w-45 h-45" />
                        ) : (
                          <img src={`data:image/png;base64,${iciciQrData.qrCode}`} alt="ICICI Payment QR" className="w-45 h-45" />
                        )}
                      </div>
                    )}
                    {iciciQrData?.qrString && !iciciQrData?.qrCode && (
                      <div className="rounded-xl border border-evegah-border bg-white p-4 inline-flex">
                        <QRCodeCanvas value={iciciQrData.qrString} size={180} />
                      </div>
                    )}
                    {!iciciQrLoading && !iciciQrError && !iciciQrData?.qrCode && !iciciQrData?.qrString && (
                      <p className="text-sm text-gray-500">
                        ICICI QR not available
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    {upiPayload && (
                      <div className="rounded-xl border border-evegah-border bg-white p-4 inline-flex">
                        <QRCodeCanvas value={upiPayload} size={180} />
                      </div>
                    )}
                    {!configuredUpiId ? (
                      <p className="text-sm text-red-600">
                        UPI QR is not configured. Set <code>VITE_EVEGAH_UPI_ID</code> in frontend <code>.env</code> or <code>EVEGAH_UPI_ID</code> (or <code>ICICI_VPA</code>) in backend <code>server/.env</code>.
                      </p>
                    ) : null}
                  </>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">
                Cash payment mode selected. No QR code required.
              </p>
            )}

            <div className="text-sm text-evegah-text space-y-1">
              <div>
                <span className="text-gray-500">Total Amount:</span> ₹{amount}
              </div>
              <div>
                <span className="text-gray-500">Payment Mode:</span> {paymentModeLabel}
              </div>
              {paymentMode === "split" ? (
                <>
                  <div>
                    <span className="text-gray-500">Cash Paid:</span> ₹{cashAmount}
                  </div>
                  <div>
                    <span className="text-gray-500">Online Paid:</span> ₹{onlineAmount}
                  </div>
                  <div>
                    <span className="text-gray-500">Total Paid:</span> ₹{totalPaid}
                  </div>
                  {shouldShowQR && (
                    <div>
                      <span className="text-gray-500">QR Amount:</span> ₹{qrAmount}
                    </div>
                  )}
                </>
              ) : paymentMode === "cash" ? (
                <div>
                  <span className="text-gray-500">Cash Paid:</span> ₹{cashAmount}
                </div>
              ) : (
                <div>
                  <span className="text-gray-500">Online Paid:</span> ₹{onlineAmount}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-evegah-border bg-white p-4 space-y-3">
          <h4 className="font-medium text-evegah-text">Actions</h4>
          <p className="text-sm text-gray-500">
            Download or send the receipt after completion.
          </p>

          {!completed ? (
            <div className="flex flex-wrap gap-2 print:hidden">
              <button
                type="button"
                className="btn-outline"
                onClick={() => navigate("../step-4")}
                disabled={submitting}
                aria-disabled={submitting}
              >
                {"\u2190"} Back
              </button>

              <button
                type="button"
                className="btn-primary"
                onClick={handleSubmit}
                disabled={submitting}
                aria-disabled={submitting}
              >
                {submitting ? "Saving..." : "Complete"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                Rider registered successfully.
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-outline" onClick={handleDownloadReceipt}>
                  Download Receipt (PDF)
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSendWhatsApp}
                  disabled={sendingWhatsApp}
                  aria-disabled={sendingWhatsApp}
                >
                  {sendingWhatsApp ? "Sending..." : "Send on WhatsApp"}
                </button>

                <button type="button" className="btn-muted" onClick={handleNewRegistration}>
                  New Registration
                </button>
              </div>
            </div>
          )}

          {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}
          {whatsAppStatus ? (
            <p
              className={
                "text-sm " +
                (whatsAppStatus.toLowerCase().includes("sent") ||
                  whatsAppStatus.toLowerCase().includes("opened")
                  ? "text-green-700"
                  : "text-red-600")
              }
            >
              {whatsAppStatus}
            </p>
          ) : null}

          {whatsAppFallback?.mediaUrl ? (
            <div className="rounded-xl border border-evegah-border bg-gray-50 p-3 text-sm text-evegah-text">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-gray-600 break-all">
                  Manual link: {whatsAppFallback.mediaUrl}
                </span>
                <button type="button" className="btn-outline" onClick={openManualWhatsApp}>
                  Open WhatsApp (manual)
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

