import { createContext, useState, useEffect } from "react";
import {
  createRiderDraft,
  getRiderDraft,
  updateRiderDraft,
} from "../../utils/riderDrafts";

const RiderFormContext = createContext();

const defaultFormData = {
  name: "",
  phone: "",
  aadhaar: "",
  operationalZone: "Gotri Zone",
  permanentAddress: "",
  temporaryAddress: "",
  sameAddress: false,
  reference: "",
  dob: "",
  gender: "",
  riderPhoto: null,
  governmentId: null,
  aadhaarVerified: false,
  draftSavedAt: null,
  draftId: null,
  rentalStart: "",
  rentalEnd: "",
  rentalEndManual: false,
  rentalPackage: "daily",
  rentalAmount: 250,
  securityDeposit: 300,
  totalAmount: 550,
  paymentMode: "cash",
  cashAmount: 550,
  onlineAmount: 0,
  bikeModel: "MINK",
  bikeId: "",
  batteryId: "",
  vehicleNumber: "",
  accessories: [],
  otherAccessories: "",
  preRidePhotos: [],
  agreementAccepted: false,
  agreementConfirmInfo: false,
  agreementAcceptTerms: false,
  riderSignature: null,
  agreementDate: "",
  issuedByName: "",
  paymentModeFinal: "",
  amountPaid: 0,
  isRetainRider: false,
  existingRiderId: null,
  activeRentalId: null,
};

export function RiderFormProvider({ children, user, initialDraftId = null }) {
  const [formData, setFormData] = useState({ ...defaultFormData });
  const [errors, setErrors] = useState({});
  const [draftMeta, setDraftMeta] = useState(null);
  const [draftId, setDraftId] = useState(initialDraftId);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(initialDraftId));

  // ...existing useEffect and logic from original file...

  const resetForm = () => {
    setFormData({ ...defaultFormData });
    setErrors({});
    setDraftMeta(null);
    setDraftId(null);
    setLoadingDraft(false);
  };

  return (
    <RiderFormContext.Provider
      value={{
        formData,
        setFormData,
        errors,
        setErrors,
        resetForm,
        draftMeta,
        draftId,
        loadingDraft,
      }}
    >
      {children}
    </RiderFormContext.Provider>
  );
}

export { RiderFormContext };
