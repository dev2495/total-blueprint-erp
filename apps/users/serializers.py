from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from .models import CompanyProfile, User, Role, UserProfileChangeRequest
from .permission_registry import is_assignable_permission, normalize_permission_code
from .permission_service import PermissionService


def _is_admin_request_actor(user) -> bool:
    role_code = str(getattr(getattr(user, "role", None), "code", "") or "").upper()
    return bool(getattr(user, "is_authenticated", False) and (user.is_superuser or user.is_owner or role_code in {"ADMIN", "SUPER_ADMIN", "OWNER"}))

class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ['id', 'code', 'name', 'description', 'default_permissions']

class UserSerializer(serializers.ModelSerializer):
    role_info = RoleSerializer(source='role', read_only=True)
    role_id = serializers.PrimaryKeyRelatedField(
        queryset=Role.objects.all(), source='role', write_only=True, required=False, allow_null=True
    )
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)
    
    full_name = serializers.SerializerMethodField()
    entitlements = serializers.SerializerMethodField()
    email_missing = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'first_name',
            'last_name',
            'email',
            'phone_number',
            'avatar_url',
            'is_active',
            'role_info',
            'role_id',
            'password',
            'full_name',
            'email_missing',
            'is_owner',
            'extra_permissions',
            'entitlements',
        ]

    def get_full_name(self, obj):
        return f"{obj.first_name} {obj.last_name}".strip() or obj.username

    def get_email_missing(self, obj):
        return not bool(str(obj.email or "").strip())

    def get_entitlements(self, obj):
        # DRF's JWT authentication replaces request.user AFTER middleware runs,
        # so we need to re-apply the role override here using the request context
        request = self.context.get('request')
        if request:
            # Check for role override header
            override_role = request.headers.get('X-Role-Override')
            if not override_role:
                override_role = request.META.get('HTTP_X_ROLE_OVERRIDE')
            
            # Only allow override for admin/owner users
            if (
                override_role
                and bool(getattr(settings, "ALLOW_ROLE_OVERRIDE", False))
                and (obj.is_superuser or obj.is_owner or (obj.role and obj.role.code in ['ADMIN', 'SUPER_ADMIN']))
            ):
                obj.effective_role_code = override_role
            elif not hasattr(obj, 'effective_role_code'):
                obj.effective_role_code = obj.role.code if obj.role else 'GUEST'
        
        return PermissionService.get_entitlements(obj)

    def validate_email(self, value):
        normalized = str(value or "").strip()
        if not normalized:
            raise serializers.ValidationError("Email is required.")
        return normalized.lower()

    def validate_extra_permissions(self, value):
        cleaned = []
        seen = set()
        for permission in value or []:
            normalized = normalize_permission_code(permission)
            if not normalized or normalized in seen:
                continue
            if not is_assignable_permission(normalized):
                raise serializers.ValidationError(
                    f"Permission '{normalized}' is not assignable as user-level override."
                )
            cleaned.append(normalized)
            seen.add(normalized)
        return cleaned

    def _build_password_validation_user(self, attrs) -> User:
        candidate = User(pk=getattr(self.instance, "pk", None))
        for field in ("username", "email", "first_name", "last_name"):
            setattr(
                candidate,
                field,
                attrs.get(field, getattr(self.instance, field, "") if self.instance else ""),
            )
        return candidate

    def _validate_candidate_password(self, password: str, attrs) -> None:
        try:
            validate_password(password, user=self._build_password_validation_user(attrs))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get("request")
        is_create = self.instance is None
        incoming_email = attrs.get("email")
        final_email = incoming_email if incoming_email is not None else (self.instance.email if self.instance else "")
        if not str(final_email or "").strip():
            raise serializers.ValidationError({"email": "Email is required."})
        if is_create and not attrs.get("password"):
            raise serializers.ValidationError({"password": "Password is required for new users."})
        if attrs.get("password"):
            self._validate_candidate_password(str(attrs["password"]), attrs)
        if not is_create and request and request.user == self.instance and "email" in attrs and not _is_admin_request_actor(request.user):
            raise serializers.ValidationError({"email": "Self email updates must go through profile change approval."})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class UserProfileChangeRequestSerializer(serializers.ModelSerializer):
    requested_by_username = serializers.CharField(source="requested_by.username", read_only=True)
    target_username = serializers.CharField(source="target_user.username", read_only=True)
    reviewed_by_username = serializers.CharField(source="reviewed_by.username", read_only=True)

    class Meta:
        model = UserProfileChangeRequest
        fields = [
            "id",
            "requested_by",
            "requested_by_username",
            "target_user",
            "target_username",
            "requested_changes",
            "status",
            "review_notes",
            "reviewed_by",
            "reviewed_by_username",
            "reviewed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "requested_by",
            "target_user",
            "status",
            "reviewed_by",
            "reviewed_at",
            "created_at",
            "updated_at",
        ]

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

class MyTokenObtainPairSerializer(TokenObtainPairSerializer):
    username = serializers.CharField(required=False)
    identifier = serializers.CharField(required=False, allow_blank=False, write_only=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields[self.username_field].required = False

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        # Add custom claims
        token['role'] = user.role.code if user.role else 'GUEST'
        token['is_owner'] = user.is_owner
        return token

    def validate(self, attrs):
        attrs = attrs.copy()
        identifier = str(attrs.get("identifier") or attrs.get("username") or "").strip()
        password = attrs.get("password")
        if not identifier or not password:
            raise serializers.ValidationError("identifier and password are required.")

        lookup_user = User.objects.filter(email__iexact=identifier).first()
        if not lookup_user:
            lookup_user = User.objects.filter(username=identifier).first()

        username = lookup_user.username if lookup_user else identifier
        auth_kwargs = {
            self.username_field: username,
            "password": password,
        }
        request = self.context.get("request")
        if request is not None:
            auth_kwargs["request"] = request
        user = authenticate(**auth_kwargs)
        if user is None or not user.is_active:
            raise serializers.ValidationError("No active account found with the given credentials.")

        update_last_login(None, user)
        refresh = self.get_token(user)
        self.user = user
        return {
            "refresh": str(refresh),
            "access": str(refresh.access_token),
        }


class CompanyProfileSerializer(serializers.ModelSerializer):
    updated_by_username = serializers.SerializerMethodField()

    class Meta:
        model = CompanyProfile
        fields = [
            "id",
            "legal_name",
            "trading_name",
            "tagline",
            "address_line1",
            "address_line2",
            "city",
            "state",
            "country",
            "pincode",
            "phone_primary",
            "phone_secondary",
            "email",
            "website",
            "gstin",
            "pan",
            "cin",
            "udyam",
            "iec_code",
            "bank_name",
            "bank_branch",
            "bank_account_no",
            "bank_ifsc",
            "bank_upi",
            "default_payment_terms",
            "default_jurisdiction",
            "quote_validity_days",
            "quote_terms_text",
            "authorised_signatory_name",
            "authorised_signatory_role",
            "logo_path",
            "updated_at",
            "updated_by_username",
        ]
        read_only_fields = ["id", "updated_at", "updated_by_username"]

    def get_updated_by_username(self, obj):
        u = getattr(obj, "updated_by", None)
        if not u:
            return ""
        return getattr(u, "username", "") or ""
